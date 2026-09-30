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
import { InternalServerError, NotFoundError } from '../../lib/errors.js';

/**
 * Message with pagination metadata
 */
export interface MessagePage {
  messages: DialogueHistory[];
  hasMore: boolean;
  total: number;
}

/** The client marks the opening scene it saves with `context.initial_greeting` (#2379). */
const isInitialGreeting = (message: {
  speakerType: string;
  context?: Record<string, unknown>;
}): boolean => message.speakerType === 'dm' && message.context?.initial_greeting === true;

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

      // #2379: a session has one opening scene. The game view can mount twice before the first
      // greeting lands (the client's init lock is released on unmount), and each mount saves the
      // greeting under its own id, so the primary key cannot catch the second. Serialise on the
      // session row, so an overlapping save waits for the first to commit and then sees it, and
      // keep the greeting already stored instead of writing another.
      let batch = messages;
      let existingGreetings: DialogueHistory[] = [];
      if (messages.some(isInitialGreeting)) {
        await tx
          .select({ id: gameSessions.id })
          .from(gameSessions)
          .where(eq(gameSessions.id, sessionId))
          .for('update');
        existingGreetings = await tx
          .select()
          .from(dialogueHistory)
          .where(
            and(
              eq(dialogueHistory.sessionId, sessionId),
              eq(dialogueHistory.speakerType, 'dm'),
              sql`${dialogueHistory.context}->>'initial_greeting' = 'true'`,
            ),
          )
          .limit(1);
        if (existingGreetings.length > 0) {
          batch = messages.filter((data) => !isInitialGreeting(data));
        }
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
      if (toInsert.length === 0) return [...existingGreetings, ...reconciled];

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
      return [...existingGreetings, ...reconciled, ...inserted];
    });
  }

  static async messageExists(
    sessionId: string,
    messageId: string,
    userId: string,
  ): Promise<boolean> {
    const session = await db.query.gameSessions.findFirst({
      where: (session, { and, eq }) =>
        and(eq(session.id, sessionId), getOwnershipCondition(userId, session)),
      columns: { id: true },
    });
    if (!session) throw new NotFoundError('Session', sessionId);

    const message = await db.query.dialogueHistory.findFirst({
      where: and(eq(dialogueHistory.id, messageId), eq(dialogueHistory.sessionId, sessionId)),
      columns: { id: true },
    });
    return Boolean(message);
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
