import { and, asc, desc, eq, gte, isNull, sql } from 'drizzle-orm';

import { CampaignService } from './campaign-service.js';
import { generateEmbedding, generateEmbeddingDetailed } from './embedding-service.js';
import {
  RECALL_BUDGET_MS,
  recallWithBudget,
  shouldRunMatch,
  takeRecallSlot,
} from './memory-recall.js';
import { SessionService } from './session-service.js';
import { db } from '../../../db/client';
import { gameSessions, memories, type Memory, type NewMemory } from '../../../db/schema/index';
import { EMBEDDING_MODEL } from '../../../shared/embedding-limits.js';
import { alert } from '../lib/alerting.js';
import { NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

/**
 * Generate a memory's embedding and write it onto the row that already exists.
 *
 * Deliberately not awaited by `insert()`. The row is durable the moment the INSERT commits;
 * the vector is an enrichment, and a player's turn must not wait on Google to get its
 * confirmation. This is the same fire-and-forget contract as `alert()` in lib/alerting.ts:
 * it never throws into its caller and it never hands the caller a promise worth awaiting.
 *
 * The consequence is a race by design — for the few hundred milliseconds between the INSERT
 * and this UPDATE the row exists with a null embedding and cannot be matched by similarity.
 * That is the correct trade for a memory system that writes on every turn, and it is why the
 * failure case pages instead of passing silently: nine months of null embeddings (#1822) were
 * invisible precisely because nothing was told when a write produced no vector (#1816).
 *
 * `updatedAt` is left alone on purpose. The memory's content did not change; only the
 * system's index of it did, and bumping the timestamp would make an internal write look like
 * an edit to anything reading recency.
 */
export async function attachEmbedding(
  memoryId: string,
  content: string,
  sessionId?: string,
): Promise<void> {
  try {
    const embedding = await generateEmbedding(content, 'RETRIEVAL_DOCUMENT');
    await db.update(memories).set({ embedding }).where(eq(memories.id, memoryId));
  } catch (error) {
    alert('memory_embedding_failed', {
      sessionId,
      error: `memory=${memoryId} ${error instanceof Error ? error.message : String(error)}`,
    });
  }
}

/**
 * Embed a batch one row at a time rather than all at once: a 50-memory insert would
 * otherwise open 50 simultaneous connections to Google. Sequential is slower and nobody is
 * waiting on it. `attachEmbedding` never rejects, so neither does this.
 */
async function attachEmbeddingsInOrder(rows: Memory[]): Promise<void> {
  for (const row of rows) {
    await attachEmbedding(row.id, row.content, row.sessionId ?? undefined);
  }
}

/** A memory row read back without its embedding, as `list()` returns it. */
type StoredMemory = Omit<Memory, 'embedding'>;

/**
 * The client marks the foundational memories it writes when a session opens with
 * `metadata.is_initial_memory` (#2386). Each session has one per (type, subcategory).
 */
const isInitialMemory = (record: NewMemory): boolean =>
  Boolean(record.sessionId) &&
  (record.metadata as { is_initial_memory?: unknown } | null | undefined)?.is_initial_memory ===
    true;

export class MemoryService {
  static async list(
    sessionId: string,
    userId: string,
    options: {
      limit?: number;
      category?: string;
      recentSince?: Date;
      minNarrativeWeight?: number;
      top?: boolean;
    } = {},
  ) {
    await SessionService.getSessionById(sessionId, userId);
    const conditions = [eq(memories.sessionId, sessionId)];
    if (options.category)
      conditions.push(sql`${memories.metadata}->>'category' = ${options.category}`);
    if (options.recentSince) conditions.push(gte(memories.createdAt, options.recentSince));
    if (options.minNarrativeWeight) {
      conditions.push(gte(memories.narrativeWeight, options.minNarrativeWeight));
    }
    return db.query.memories.findMany({
      where: and(...conditions),
      // ⚡ Bolt: Explicitly exclude the heavy embedding column to prevent over-fetching (~3KB per row)
      // and reduce memory/network overhead for simple lists where similarity is not needed.
      columns: {
        embedding: false,
      },
      orderBy: options.top
        ? [desc(memories.importance), desc(memories.createdAt)]
        : [options.minNarrativeWeight ? asc(memories.createdAt) : desc(memories.createdAt)],
      limit: options.limit ?? 50,
    });
  }

  static async insert(records: NewMemory[], userId: string) {
    if (records.length === 0) return [];

    // ⚡ Bolt: Batch ownership verification to avoid N+1 queries.
    // Instead of querying ownership for each record sequentially, we gather unique session
    // and campaign IDs and verify their ownership in parallel. Since records usually share
    // the same sessionId, this reduces queries from O(N) to O(1).
    const uniqueSessionIds = new Set<string>();
    const uniqueCampaignIds = new Set<string>();

    for (const record of records) {
      if (record.sessionId) {
        uniqueSessionIds.add(record.sessionId);
      } else if (record.campaignId) {
        uniqueCampaignIds.add(record.campaignId);
      } else {
        throw new NotFoundError('Memory parent', 'unknown');
      }
    }

    // Run verification for all unique IDs in parallel
    await Promise.all([
      ...Array.from(uniqueSessionIds).map((sessionId) =>
        SessionService.getSessionById(sessionId, userId),
      ),
      ...Array.from(uniqueCampaignIds).map(async (campaignId) => {
        const campaign = await CampaignService.getById(campaignId, userId);
        if (!campaign) {
          throw new NotFoundError('Memory parent', campaignId);
        }
      }),
    ]);

    const { rows, fresh }: { rows: Array<Memory | StoredMemory>; fresh: Memory[] } = records.some(
      isInitialMemory,
    )
      ? await MemoryService.insertInitialOnce(records)
      : await db
          .insert(memories)
          .values(records)
          .returning()
          .then((inserted) => ({ rows: inserted, fresh: inserted }));

    // The write is done; embedding happens after it and off the caller's clock. Explicitly
    // voided so it can never be awaited by accident and can never surface as an unhandled
    // rejection — see attachEmbedding above for why this is not a bug to be "fixed" by
    // awaiting it.
    void attachEmbeddingsInOrder(fresh);

    return rows;
  }

  /**
   * #2386: a session has one set of opening memories. The game view can mount twice before the
   * first greeting lands, and each mount writes the set, so a record marked `is_initial_memory`
   * is skipped when the session already holds one of the same (type, subcategory) and that one
   * is returned in its place. Serialised on the session row like the once-per-session messages
   * in SessionMessageService.addMessages, so an overlapping write waits for the first to commit
   * and then sees it. `fresh` is what this call inserted, the only rows that need embedding.
   */
  private static async insertInitialOnce(
    records: NewMemory[],
  ): Promise<{ rows: Array<Memory | StoredMemory>; fresh: Memory[] }> {
    return db.transaction(async (tx) => {
      // In id order, so two batches that span the same sessions cannot lock them crosswise.
      const sessionIds = [...new Set(records.filter(isInitialMemory).map((r) => r.sessionId!))];
      for (const sessionId of sessionIds.sort()) {
        await tx
          .select({ id: gameSessions.id })
          .from(gameSessions)
          .where(eq(gameSessions.id, sessionId))
          .for('no key update');
      }

      const stored = new Map<NewMemory, StoredMemory>();
      for (const record of records.filter(isInitialMemory)) {
        const existing = await tx.query.memories.findFirst({
          where: and(
            eq(memories.sessionId, record.sessionId!),
            sql`${memories.metadata}->>'is_initial_memory' = 'true'`,
            record.type == null ? isNull(memories.type) : eq(memories.type, record.type),
            record.subcategory == null
              ? isNull(memories.subcategory)
              : eq(memories.subcategory, record.subcategory),
          ),
          columns: { embedding: false },
          orderBy: asc(memories.createdAt),
        });
        if (existing) stored.set(record, existing);
      }

      const toInsert = records.filter((record) => !stored.has(record));
      const fresh =
        toInsert.length > 0 ? await tx.insert(memories).values(toInsert).returning() : [];
      const freshRows = new Map(toInsert.map((record, index) => [record, fresh[index]!]));
      return {
        rows: records.map((record) => stored.get(record) ?? freshRows.get(record)!),
        fresh,
      };
    });
  }

  static async getById(memoryId: string, userId: string) {
    const memory = await db.query.memories.findFirst({
      where: eq(memories.id, memoryId),
      // ⚡ Bolt: Explicitly exclude the heavy embedding column to prevent over-fetching (~3KB per row)
      // and reduce memory/network overhead when fetching details of a memory.
      columns: {
        embedding: false,
      },
    });
    if (!memory) throw new NotFoundError('Memory', memoryId);
    await this.verifyRecordOwnership(memory, userId);
    return memory;
  }

  static async updateScores(
    memoryId: string,
    userId: string,
    updates: { importance?: number; narrativeWeight?: number },
  ): Promise<void> {
    await this.getById(memoryId, userId);
    await db
      .update(memories)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(memories.id, memoryId));
  }

  static async updateContent(memoryId: string, userId: string, content: string): Promise<void> {
    await this.getById(memoryId, userId);
    await db
      .update(memories)
      .set({ content, updatedAt: new Date() })
      .where(eq(memories.id, memoryId));
  }

  /**
   * DM recall: a few similar rows, then top-by-importance, deduped, same limit.
   * Embed + match are capped at {@link RECALL_BUDGET_MS}. Failure returns importance only.
   */
  static async recall(
    sessionId: string,
    userId: string,
    query: string,
    limit: number,
    plan: string,
  ) {
    await SessionService.getSessionById(sessionId, userId);
    const loadImportant = () => this.list(sessionId, userId, { limit, top: true });
    if (!query.trim()) {
      return loadImportant();
    }
    // 30 embeds per user per minute. Over the cap we still return importance,
    // and we never answer 402 or 429 — a DM turn must not fail because of recall.
    if (!takeRecallSlot(userId)) {
      logger.warn({ msg: 'MEMORY_RECALL_FALLBACK', sessionId, error: 'rate_limit' });
      logger.info({ msg: 'MEMORY_RECALL_MS', sessionId, ms: 0, fellBack: true });
      return loadImportant();
    }
    const started = Date.now();
    const result = await recallWithBudget({
      limit,
      loadImportant,
      loadSimilar: async () => {
        const remaining = RECALL_BUDGET_MS - (Date.now() - started);
        if (!shouldRunMatch(started, RECALL_BUDGET_MS)) {
          throw new Error('memory_recall_budget');
        }
        const embedded = await generateEmbeddingDetailed(
          query,
          'RETRIEVAL_QUERY',
          AbortSignal.timeout(Math.max(1, remaining)),
        );
        if (!shouldRunMatch(started, RECALL_BUDGET_MS)) {
          throw new Error('memory_recall_budget');
        }
        // Google Gemini embedding price, $0.15 / 1M input tokens. Output is empty.
        const costUsd = (embedded.inputTokens * 0.15) / 1_000_000;
        const { AIUsageService } = await import('./ai-usage-service.js');
        await AIUsageService.recordProviderUsage({
          userId,
          plan,
          type: 'llm_system',
          provider: 'google',
          model: EMBEDDING_MODEL,
          inputTokens: embedded.inputTokens,
          outputTokens: 0,
          costUsd,
          sessionId,
        });
        const vector = `[${embedded.values.join(',')}]`;
        const left = RECALL_BUDGET_MS - (Date.now() - started);
        const matched = await this.matchWithin(sessionId, userId, vector, limit, 0.7, left);
        return matched.map((row) => matchRow(row as Record<string, unknown>)) as Awaited<
          ReturnType<typeof MemoryService.list>
        >;
      },
      logFallback: (error) => {
        logger.warn({
          msg: 'MEMORY_RECALL_FALLBACK',
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
    // info, not debug: production logs at info, and Hetzner times recall from this line.
    logger.info({
      msg: 'MEMORY_RECALL_MS',
      sessionId,
      ms: result.elapsedMs,
      fellBack: result.fellBack,
    });
    return result.rows;
  }

  /** Match, but stop the statement if the recall budget has only this long left. */
  private static async matchWithin(
    sessionId: string,
    userId: string,
    embedding: string,
    limit: number,
    threshold: number,
    timeoutMs: number,
  ): Promise<unknown[]> {
    await SessionService.getSessionById(sessionId, userId);
    const ms = String(Math.max(1, Math.floor(timeoutMs)));
    const result = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('statement_timeout', ${ms}, true)`);
      return tx.execute(sql`
        SELECT * FROM match_memories(
          ${embedding}::vector,
          ${sessionId}::uuid,
          ${threshold}::float,
          ${limit}::int
        )
      `);
    });
    return Array.from(result as Iterable<unknown>);
  }

  static async match(
    sessionId: string,
    userId: string,
    embedding: string,
    limit: number,
    threshold: number,
  ): Promise<unknown[]> {
    await SessionService.getSessionById(sessionId, userId);
    const result = await db.execute(sql`
      SELECT * FROM match_memories(
        ${embedding}::vector,
        ${sessionId}::uuid,
        ${threshold}::float,
        ${limit}::int
      )
    `);
    return Array.from(result as Iterable<unknown>);
  }

  private static async verifyRecordOwnership(
    record: Pick<NewMemory, 'sessionId' | 'campaignId'>,
    userId: string,
  ): Promise<void> {
    if (record.sessionId) {
      await SessionService.getSessionById(record.sessionId, userId);
      return;
    }
    if (record.campaignId) {
      const campaign = await CampaignService.getById(record.campaignId, userId);
      if (campaign) return;
    }
    throw new NotFoundError('Memory parent', record.sessionId || record.campaignId || 'unknown');
  }
}

/** `match_memories` returns snake_case columns. List rows are camelCase. */
function matchRow(raw: Record<string, unknown>) {
  return {
    id: String(raw.id),
    campaignId: (raw.campaign_id as string | null) ?? null,
    sessionId: (raw.session_id as string | null) ?? null,
    type: (raw.type as string | null) ?? null,
    memoryType: (raw.memory_type as string | null) ?? null,
    subcategory: (raw.subcategory as string | null) ?? null,
    content: String(raw.content ?? ''),
    importance: (raw.importance as number | null) ?? null,
    narrativeWeight: (raw.narrative_weight as number | null) ?? null,
    context: raw.context ?? null,
    metadata: raw.metadata ?? null,
    emotionalTone: (raw.emotional_tone as string | null) ?? null,
    storyArc: (raw.story_arc as string | null) ?? null,
    proseQuality: Boolean(raw.prose_quality),
    chapterMarker: Boolean(raw.chapter_marker),
    createdAt: raw.created_at ?? null,
    updatedAt: raw.updated_at ?? null,
  };
}
