/* eslint-disable max-lines */
import { and, eq, asc, desc, sql, exists } from 'drizzle-orm';

import { getOwnershipCondition } from './session-authorization.js';
import { db } from '../../../../db/client';
import {
  gameSessions,
  dialogueHistory,
  type GameSession,
  type DialogueHistory,
} from '../../../../db/schema/index';
import { transactionContext } from '../../../../db/transaction-context';
import { ConflictError, InternalServerError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

/**
 * Message with pagination metadata
 */
export interface MessagePage {
  messages: DialogueHistory[];
  hasMore: boolean;
  total: number;
}

/**
 * DM messages a session holds once: the opening scene (`context.initial_greeting`, #2379) and
 * the "Previously On" recap of a continuation session (`context.previously_on`, #2386). The
 * client marks them when it saves them.
 */
const ONCE_PER_SESSION_MARKS = ['initial_greeting', 'previously_on'] as const;
type OncePerSessionMark = (typeof ONCE_PER_SESSION_MARKS)[number];

const oncePerSessionMark = (message: {
  speakerType: string;
  context?: Record<string, unknown>;
}): OncePerSessionMark | undefined =>
  message.speakerType === 'dm'
    ? ONCE_PER_SESSION_MARKS.find((mark) => message.context?.[mark] === true)
    : undefined;

/**
 * Context key carrying a completed DM-turn response for replay under its reply
 * id (#51). Follows the `rollTurnResult` / `npcResult` precedents: the response
 * lives in a dialogue row's context, so it needs no new table and no TTL — it
 * lives as long as the row does.
 */
const CACHED_TURN_RESPONSE_KEY = 'cachedTurnResponse';

/**
 * Sibling key binding a cached turn response to the player input it was
 * generated for (#1270). A retry reuses the reply id with the identical
 * input, so the binding matches; a reused id with a different input is a
 * different turn and must 409, never replay the old body. Rows cached before
 * this key existed carry no binding and still replay (legacy entries).
 */
const CACHED_TURN_RESPONSE_INPUT_KEY = 'cachedTurnResponseInput';

/**
 * A completed turn body is replayable: a plain object carrying reply text,
 * not an error, and not a degraded placeholder. A degraded body ("try your
 * action again") must never be frozen as the canonical replay — the retry has
 * to generate anew.
 */
function asCachedTurnResponse(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if ('error' in record || record.degraded === true || typeof record.text !== 'string')
    return undefined;
  return record;
}

/**
 * Best-effort: store a completed turn response under its reply id, then read
 * back whatever the row now holds under that key (#51). Never throws: a failed
 * write degrades to today's behavior (the retry regenerates). The first
 * completed response wins: the write is a no-op once the key exists, so a
 * concurrent duplicate cannot overwrite the canonical response — and the
 * read-back lets a duplicate that also generated return the winner's body
 * instead of its own, when the winner's write is still the row's context at
 * read-back time. It is not airtight under concurrency: the duplicate's own
 * provisional persist replaces a provisional row's context wholesale (#2218),
 * so a persist that lands after the winner's write drops the cached entry
 * and the duplicate keeps its own body. The guaranteed case is the
 * sequential lost-response retry. The write runs under a 500 ms lock bound
 * (#1270): it must never stall the response behind a contended row, and a
 * contended write degrades to today's behavior (the retry regenerates).
 *
 * Returns the cached body when the row exists, or undefined when there is no
 * row to cache onto: turns the server does not persist (the dmReply skip
 * reasons — in-combat, roll-request, and like cases) have no provisional row,
 * so a retry of one regenerates. That miss is logged, so the boundary stays
 * observable instead of silent.
 */
async function cacheTurnResponseAndReplay(
  sessionId: string,
  replyId: string,
  response: Record<string, unknown>,
  playerInput: string | null,
): Promise<Record<string, unknown> | undefined> {
  try {
    const outcome = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '500ms'`);
      await tx
        .update(dialogueHistory)
        .set({
          context: sql`coalesce(${dialogueHistory.context}, '{}'::jsonb) || ${JSON.stringify({ [CACHED_TURN_RESPONSE_KEY]: response, [CACHED_TURN_RESPONSE_INPUT_KEY]: playerInput })}::jsonb`,
        })
        .where(
          and(
            eq(dialogueHistory.id, replyId),
            eq(dialogueHistory.sessionId, sessionId),
            eq(dialogueHistory.speakerType, 'dm'),
            sql`${dialogueHistory.context}->>(${CACHED_TURN_RESPONSE_KEY}::text) IS NULL`,
          ),
        );
      const [row] = await tx
        .select({ context: dialogueHistory.context })
        .from(dialogueHistory)
        .where(
          and(
            eq(dialogueHistory.id, replyId),
            eq(dialogueHistory.sessionId, sessionId),
            eq(dialogueHistory.speakerType, 'dm'),
          ),
        )
        .limit(1);
      if (!row) return { found: false as const };
      return {
        found: true as const,
        cached: asCachedTurnResponse(
          (row.context as Record<string, unknown> | null)?.[CACHED_TURN_RESPONSE_KEY],
        ),
      };
    });
    if (!outcome.found)
      logger.info({
        msg: 'DM_TURN_RESPONSE_CACHE_ROW_MISSING',
        sessionId,
        messageId: replyId,
      });
    return outcome.found ? outcome.cached : undefined;
  } catch (error) {
    logger.warn({
      msg: 'DM_TURN_RESPONSE_CACHE_WRITE_FAILED',
      sessionId,
      messageId: replyId,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/**
 * Session Message Service
 * Handles message history and dialogue management for game sessions.
 */
export class SessionMessageService {
  /**
   * Get session with message history
   */
  static async getSessionWithMessages(
    sessionId: string,
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
    },
  ): Promise<{
    session: GameSession;
    messages: DialogueHistory[];
    total: number;
  }> {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    // ⚡ Bolt: Parallelize session fetch and combined message/count query to reduce total latency.
    // Reducing database round-trips from 3 to 2 by using PostgreSQL window function count(*) OVER().
    const [session, messagesWithCount] = await Promise.all([
      db.query.gameSessions.findFirst({
        where: (session, { and, eq }) =>
          and(eq(session.id, sessionId), getOwnershipCondition(userId, session)),
        columns: { id: true }, // ⚡ Bolt: Only fetch ID for existence/ownership check
      }),
      db
        .select({
          message: dialogueHistory,
          totalCount: sql<number>`(count(*) OVER())::int`.as('total_count'),
        })
        .from(dialogueHistory)
        .where(
          and(
            eq(dialogueHistory.sessionId, sessionId),
            // 🛡️ Sentinel: Incorporate ownership check directly into the dialogue history query
            // for defense-in-depth, ensuring no messages are leaked even if session check is bypassed.
            exists(
              db
                .select()
                .from(gameSessions)
                .where(
                  and(
                    eq(gameSessions.id, dialogueHistory.sessionId),
                    getOwnershipCondition(userId),
                  ),
                ),
            ),
          ),
        )
        .orderBy(asc(dialogueHistory.timestamp))
        .limit(limit)
        .offset(offset),
    ]);

    if (!session) {
      throw new NotFoundError('Session', sessionId);
    }

    return {
      session: session as GameSession,
      messages: messagesWithCount.map((r) => r.message),
      total: messagesWithCount[0]?.totalCount || 0,
    };
  }

  /**
   * Add message to session
   */
  static async addMessage(
    data: {
      id?: string;
      sessionId: string;
      speakerType: string;
      speakerId?: string;
      message: string;
      context?: Record<string, unknown>;
      images?: unknown[];
      timestamp?: Date;
    },
    userId: string,
  ): Promise<DialogueHistory> {
    const [message] = await this.addMessages([data], userId);
    if (!message) {
      throw new InternalServerError('Failed to add message');
    }
    return message;
  }

  static async addMessages(
    messages: Array<{
      id?: string;
      sessionId: string;
      speakerType: string;
      speakerId?: string;
      message: string;
      context?: Record<string, unknown>;
      images?: unknown[];
      timestamp?: Date;
    }>,
    userId: string,
  ): Promise<DialogueHistory[]> {
    if (messages.length === 0) return [];
    const sessionId = messages[0]!.sessionId;
    if (messages.some((message) => message.sessionId !== sessionId)) {
      throw new InternalServerError('All messages in a batch must belong to one session');
    }

    return db.transaction(async (tx) => {
      const session = await tx.query.gameSessions.findFirst({
        where: (session, { and, eq }) =>
          and(eq(session.id, sessionId), getOwnershipCondition(userId, session)),
        columns: { id: true },
      });
      if (!session) throw new NotFoundError('Session', sessionId);

      // #2379: a session has one opening scene, and #2386: one "Previously On" recap. The game
      // view can mount twice before the first greeting lands (the client's init lock is released
      // on unmount), and each mount saves under its own id, so the primary key cannot catch the
      // second. Serialise on the session row, so an overlapping save waits for the first to
      // commit and then sees it, and keep the message already stored instead of writing another.
      // NO KEY UPDATE rather than UPDATE: two saves still queue behind each other, but the
      // foreign-key check of an unrelated insert into a child table of the session does not.
      let batch = messages;
      const existingOnce: DialogueHistory[] = [];
      if (messages.some((message) => oncePerSessionMark(message))) {
        await tx
          .select({ id: gameSessions.id })
          .from(gameSessions)
          .where(eq(gameSessions.id, sessionId))
          .for('no key update');
        const storedMarks = new Set<OncePerSessionMark>();
        for (const mark of new Set(messages.map(oncePerSessionMark))) {
          if (!mark) continue;
          const [stored] = await tx
            .select()
            .from(dialogueHistory)
            .where(
              and(
                eq(dialogueHistory.sessionId, sessionId),
                eq(dialogueHistory.speakerType, 'dm'),
                sql`${dialogueHistory.context}->>(${mark}::text) = 'true'`,
              ),
            )
            .orderBy(asc(dialogueHistory.timestamp))
            .limit(1);
          if (stored) {
            existingOnce.push(stored);
            storedMarks.add(mark);
          }
        }
        batch = messages.filter((message) => {
          const mark = oncePerSessionMark(message);
          return !mark || !storedMarks.has(mark);
        });
      }

      // Serialise answer saves by session, including retries under a new client message id.
      if (
        messages.some(
          (message) =>
            message.speakerType === 'player' &&
            message.context?.intent === 'dice_roll' &&
            typeof message.context.rollRequestId === 'string',
        )
      ) {
        await tx
          .select({ id: gameSessions.id })
          .from(gameSessions)
          .where(eq(gameSessions.id, sessionId))
          .for('no key update');
        const unique = [];
        for (const message of batch) {
          const rollId =
            message.speakerType === 'player' && message.context?.intent === 'dice_roll'
              ? message.context.rollRequestId
              : undefined;
          if (typeof rollId !== 'string') {
            unique.push(message);
            continue;
          }
          const [stored] = await tx
            .select()
            .from(dialogueHistory)
            .where(
              and(
                eq(dialogueHistory.sessionId, sessionId),
                eq(dialogueHistory.speakerType, 'player'),
                sql`${dialogueHistory.context}->>'rollRequestId' = ${rollId}`,
              ),
            )
            .limit(1);
          if (stored) existingOnce.push(stored);
          else if (!unique.some((candidate) => candidate.context?.rollRequestId === rollId))
            unique.push(message);
        }
        batch = unique;
      }

      // #2218: /v1/llm/generate writes the DM reply it produced as a provisional row under the
      // id the client reserved for the turn. The client's own save of that turn carries the same
      // id and its final text, and replaces the provisional row in place rather than being
      // dropped as a duplicate — so one turn is one row, whichever side wrote first. Only rows
      // still marked provisional are replaceable; every other duplicate id stays a no-op retry.
      // A blank save never replaces stored prose (#2280): the route's `minLength: 1` stops '' but
      // not whitespace, and #2250 tried to write a text-less row under the reply's own id. Such
      // a save falls through to the insert below, where the id conflict makes it a no-op.
      const dmMessages = batch.filter(
        (data): data is typeof data & { id: string } =>
          Boolean(data.id) && data.speakerType === 'dm' && data.message.trim().length > 0,
      );
      const reconciled: DialogueHistory[] = [];
      for (const data of dmMessages) {
        const [row] = await tx
          .update(dialogueHistory)
          .set({
            message: data.message,
            context: data.context || null,
            images: data.images || null,
            // History is read in timestamp order and the player's row carries the client's
            // clock, so the client's timestamp replaces the server's too: a live tab orders
            // exactly as it did when the client was the only writer.
            ...(data.timestamp ? { timestamp: data.timestamp } : {}),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(dialogueHistory.id, data.id),
              eq(dialogueHistory.sessionId, sessionId),
              sql`${dialogueHistory.context}->>'provisional' = 'true'`,
            ),
          )
          .returning();
        if (row) reconciled.push(row);
      }
      const reconciledIds = new Set(reconciled.map((row) => row.id));
      const toInsert = batch.filter((data) => !data.id || !reconciledIds.has(data.id));
      if (toInsert.length === 0) return [...existingOnce, ...reconciled];

      const inserted = await tx
        .insert(dialogueHistory)
        .values(
          toInsert.map((data) => ({
            id: data.id,
            sessionId,
            speakerType: data.speakerType,
            speakerId: data.speakerId || null,
            message: data.message,
            context: data.context || null,
            images: data.images || null,
            timestamp: data.timestamp || new Date(),
          })),
        )
        .onConflictDoNothing({ target: dialogueHistory.id })
        .returning();

      if (inserted.length > 0) {
        await tx
          .update(gameSessions)
          .set({
            turnCount: sql`coalesce(${gameSessions.turnCount}, 0) + ${inserted.length}`,
            updatedAt: new Date(),
          })
          .where(eq(gameSessions.id, sessionId));
      }
      return [...existingOnce, ...reconciled, ...inserted];
    });
  }

  // A row lock serializes overlapping generations for the same roll, and the lock is held for
  // the whole provider call. The wait is bounded on purpose: SET LOCAL lock_timeout fails a
  // second submit fast (55P03, mapped to 409 "in progress" below) instead of letting it queue
  // behind a generation that can run for a minute. The client shows its wait state and retries,
  // and the retry replays the first turn's committed result.
  //
  // Atomicity contract: reply persistence and the cached rollTurnResult share this transaction.
  // A provider error or any thrown AppError propagates out of db.transaction and rolls both
  // back, so a retry never finds a half-written DM row or a cached partial result. A client
  // that hits its 90 s turn bound while a turn is still generating either replays the committed
  // result from the cache or regenerates cleanly — the transaction admits no other outcome.
  static async withRollTurn<T extends Record<string, unknown>>(
    sessionId: string,
    userId: string,
    playerInput: string | undefined,
    suppliedRollId: string | undefined,
    requestedReplyId: string | undefined,
    generate: (replyId?: string) => Promise<T>,
  ): Promise<T> {
    const afterCommit: Array<() => void> = [];
    const result = await db.transaction(async (tx) => {
      // Bound the row-lock wait: a second submit that arrives while the first turn is still
      // generating waits at most 5 s for the lock, then fails with 55P03 (mapped to 409 below)
      // instead of queueing behind the in-flight provider call.
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      const session = await tx.query.gameSessions.findFirst({
        where: (session, { and, eq }) =>
          and(eq(session.id, sessionId), getOwnershipCondition(userId, session)),
        columns: { id: true },
      });
      if (!session) throw new NotFoundError('Session', sessionId);
      let answer: typeof dialogueHistory.$inferSelect | undefined;
      try {
        [answer] = await tx
          .select()
          .from(dialogueHistory)
          .where(
            and(eq(dialogueHistory.sessionId, sessionId), eq(dialogueHistory.speakerType, 'player')),
          )
          .orderBy(desc(dialogueHistory.createdAt))
          .limit(1)
          .for('update');
      } catch (error) {
        // 55P03: the row lock is held by another turn that is still generating. Drizzle wraps
        // the postgres.js error, so the code lives on `cause`.
        const code =
          (error as { code?: string })?.code ?? (error as { cause?: { code?: string } })?.cause?.code;
        if (code === '55P03')
          throw new ConflictError('Another turn is in progress. Retry to pick up its result.');
        throw error;
      }
      // The 5 s bound was only for acquiring the row lock. The turn's own generate + writes run
      // under the normal (no) lock timeout; a 55P03 here would be a different lock, not "another
      // turn in progress", so it must not be mapped to 409.
      await tx.execute(sql`SET LOCAL lock_timeout = DEFAULT`);
      const context = answer?.context as Record<string, unknown> | null;
      const rollId =
        context?.intent === 'dice_roll' && typeof context.rollRequestId === 'string'
          ? context.rollRequestId
          : undefined;
      if (suppliedRollId && suppliedRollId !== rollId)
        throw new ConflictError(
          'This roll is missing or has been superseded by another player turn.',
        );
      // #51: a retry of a completed DM turn replays the stored response instead of
      // generating twice. The key is the reply id the client reserved for the turn
      // (dmReply.messageId), which transport retries resend unchanged; the id is
      // the idempotency key, so the same id means the same turn. The lookup runs
      // after the roll-mismatch throw above, so a reused id with a different roll
      // still gets the 409 the roll guard exists to return. It runs inside this
      // transaction behind the player-row lock, so a sequential retry — the
      // lost-response case — always sees a committed cache entry. The lock does
      // NOT serialize plain-turn generation itself: generation runs after this
      // transaction commits, so two simultaneous same-id submits can both
      // generate, and the duplicate's own provisional persist can replace the
      // row's context after the winner's write (#2218 reconcile), so the
      // canonical-body property is best-effort under concurrency, guaranteed
      // for sequential retries.
      // The cache lives in the DM row's context: a client save replaces that
      // context wholesale, dropping an entry cached before the save, but a
      // duplicate arriving after the save re-caches on completion. Turns the
      // server never persists have no row to cache onto (see the store below)
      // and regenerate on retry.
      if (requestedReplyId) {
        const [dmRow] = await tx
          .select({ context: dialogueHistory.context })
          .from(dialogueHistory)
          .where(
            and(
              eq(dialogueHistory.id, requestedReplyId),
              eq(dialogueHistory.sessionId, sessionId),
              eq(dialogueHistory.speakerType, 'dm'),
            ),
          )
          .limit(1);
        const rowContext = dmRow?.context as Record<string, unknown> | null;
        const cached = asCachedTurnResponse(rowContext?.[CACHED_TURN_RESPONSE_KEY]);
        if (cached) {
          // #1270: the cache is bound to the input it was generated for. A
          // reused reply id with a different input is a different turn: 409,
          // never the old body. Rows cached before the binding key existed
          // carry no binding and still replay.
          if (
            rowContext &&
            CACHED_TURN_RESPONSE_INPUT_KEY in rowContext &&
            rowContext[CACHED_TURN_RESPONSE_INPUT_KEY] !== (playerInput ?? null)
          )
            throw new ConflictError('This reply id was already used for a different turn.');
          return { guarded: true as const, response: cached as T };
        }
      }
      if (!rollId || (!suppliedRollId && playerInput !== answer?.message))
        return { guarded: false as const };
      // #1270: a roll result replays only when it passes the same
      // exclusion as a cached turn response — a degraded (or error) roll
      // result frozen during a provider outage must regenerate, not replay.
      const cached = asCachedTurnResponse(context?.rollTurnResult);
      if (cached) return { guarded: true as const, response: cached as T };
      const replyId = requestedReplyId ?? crypto.randomUUID();
      return transactionContext.run({ database: tx, afterCommit }, async () => {
        const response = await generate(replyId);
        // Cache the turn result for replay on the guarded path. The guarded path only runs
        // for roll turns, and the cached response carries the canonical reply id — a retry
        // replays it instead of generating twice. Unconditional (not gated on the response
        // carrying dmReplyPersisted) so turns from pre-fix clients, which send no dmReply,
        // get the same dedupe as current clients. #1270: still never freeze a
        // degraded or error result — the lookup above would skip it anyway,
        // so a degraded roll turn is left uncached and its retry regenerates.
        if (asCachedTurnResponse(response)) {
          await tx
            .update(dialogueHistory)
            .set({ context: { ...context, rollTurnResult: response } })
            .where(eq(dialogueHistory.id, answer!.id));
        }
        return { guarded: true as const, response };
      });
    });
    for (const publish of afterCommit) publish();
    const response = result.guarded ? result.response : await generate();
    // #51: keep the completed response under the turn's reply id for a retry to
    // replay, and return whatever the row now holds: a concurrent duplicate
    // that also generated replays the first-completed body. Best-effort and
    // first-wins; error and degraded bodies are never cached, so a failed turn
    // stays retryable.
    if (requestedReplyId) {
      const cacheable = asCachedTurnResponse(response);
      if (cacheable) {
        const replay = await cacheTurnResponseAndReplay(
          sessionId,
          requestedReplyId,
          cacheable,
          playerInput ?? null,
        );
        if (replay) return replay as T;
      }
    }
    return response;
  }

  /**
   * Get recent messages for session (paginated)
   */
  static async getRecentMessages(
    sessionId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<MessagePage> {
    // ⚡ Bolt: Parallelize session verification and combined message/count query to reduce total latency.
    // Reducing database round-trips from 3 to 2 by using PostgreSQL window function count(*) OVER().
    const [session, messagesWithCount] = await Promise.all([
      db.query.gameSessions.findFirst({
        where: (session, { and, eq }) =>
          and(eq(session.id, sessionId), getOwnershipCondition(userId, session)),
        columns: { id: true }, // ⚡ Bolt: Only fetch ID for existence/ownership check
      }),
      db
        .select({
          message: dialogueHistory,
          totalCount: sql<number>`(count(*) OVER())::int`.as('total_count'),
        })
        .from(dialogueHistory)
        .where(
          and(
            eq(dialogueHistory.sessionId, sessionId),
            // 🛡️ Sentinel: Incorporate ownership check directly into the dialogue history query
            // for defense-in-depth, ensuring no messages are leaked even if session check is bypassed.
            exists(
              db
                .select()
                .from(gameSessions)
                .where(
                  and(
                    eq(gameSessions.id, dialogueHistory.sessionId),
                    getOwnershipCondition(userId),
                  ),
                ),
            ),
          ),
        )
        .orderBy(desc(dialogueHistory.timestamp))
        .limit(limit)
        .offset(offset),
    ]);

    if (!session) {
      throw new NotFoundError('Session', sessionId);
    }

    const total = messagesWithCount[0]?.totalCount || 0;
    const hasMore = offset + limit < total;

    return {
      messages: messagesWithCount.map((r) => r.message).reverse(),
      hasMore,
      total,
    };
  }
}
