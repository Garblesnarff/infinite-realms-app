import { and, asc, desc, eq, gte, sql } from 'drizzle-orm';

import { CampaignService } from './campaign-service.js';
import { generateEmbedding } from './embedding-service.js';
import { SessionService } from './session-service.js';
import { db } from '../../../db/client';
import { memories, type Memory, type NewMemory } from '../../../db/schema/index';
import { alert } from '../lib/alerting.js';
import { NotFoundError } from '../lib/errors.js';

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

    const inserted = await db.insert(memories).values(records).returning();

    // The write is done; embedding happens after it and off the caller's clock. Explicitly
    // voided so it can never be awaited by accident and can never surface as an unhandled
    // rejection — see attachEmbedding above for why this is not a bug to be "fixed" by
    // awaiting it.
    void attachEmbeddingsInOrder(inserted);

    return inserted;
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
