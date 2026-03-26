/* eslint-disable max-lines */
/**
 * Session Service
 *
 * Type-safe game session management using Drizzle ORM.
 * Handles session lifecycle, message history, and state management.
 */

import { eq, and, isNull, desc, asc, sql, or, exists, type SQL } from 'drizzle-orm';

import { db } from '../../../db/client';
import { gameSessions, dialogueHistory, campaigns, characters, type GameSession, type DialogueHistory } from '../../../db/schema/index';
import { InternalServerError, NotFoundError } from '../lib/errors.js';

/**
 * Message with pagination metadata
 */
export interface MessagePage {
  messages: DialogueHistory[];
  hasMore: boolean;
  total: number;
}

/**
 * Session Service
 * Provides type-safe database operations for game sessions and messages
 */
export class SessionService {
  /**
   * Helper to build ownership condition for a session
   */
  private static getOwnershipCondition(userId: string): SQL | undefined {
    return or(
      exists(
        db.select()
          .from(campaigns)
          .where(and(
            eq(campaigns.id, gameSessions.campaignId),
            eq(campaigns.userId, userId)
          ))
      ),
      exists(
        db.select()
          .from(characters)
          .where(and(
            eq(characters.id, gameSessions.characterId),
            or(
              eq(characters.userId, userId),
              eq(characters.ownerId, userId)
            )
          ))
      )
    );
  }

  /**
   * Create a new game session
   */
  static async createSession(data: {
    campaignId?: string | null;
    characterId?: string | null;
    sessionNumber?: number;
    status?: string;
  }, userId: string): Promise<GameSession> {
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    // This ensures that sessions can only be created for campaigns or characters the user is authorized to access
    // while masking resource existence in a single atomic database round-trip.
    let session: GameSession | undefined;

    if (data.campaignId && data.characterId) {
      [session] = await db
        .insert(gameSessions)
        .select(
          db.select({
            campaignId: sql`${data.campaignId}`,
            characterId: sql`${data.characterId}`,
            sessionNumber: sql`${data.sessionNumber || 1}`,
            status: sql`${data.status || 'active'}`,
            startTime: sql`NOW()`,
          })
          .from(campaigns)
          .innerJoin(characters, eq(characters.id, data.characterId))
          .where(and(
            eq(campaigns.id, data.campaignId),
            eq(campaigns.userId, userId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId))
          ))
        )
        .returning();
    } else if (data.campaignId) {
      [session] = await db
        .insert(gameSessions)
        .select(
          db.select({
            campaignId: sql`${data.campaignId}`,
            characterId: sql`NULL::uuid`,
            sessionNumber: sql`${data.sessionNumber || 1}`,
            status: sql`${data.status || 'active'}`,
            startTime: sql`NOW()`,
          })
          .from(campaigns)
          .where(and(
            eq(campaigns.id, data.campaignId),
            eq(campaigns.userId, userId)
          ))
        )
        .returning();
    } else if (data.characterId) {
      [session] = await db
        .insert(gameSessions)
        .select(
          db.select({
            campaignId: sql`NULL::uuid`,
            characterId: sql`${data.characterId}`,
            sessionNumber: sql`${data.sessionNumber || 1}`,
            status: sql`${data.status || 'active'}`,
            startTime: sql`NOW()`,
          })
          .from(characters)
          .where(and(
            eq(characters.id, data.characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId))
          ))
        )
        .returning();
    } else {
      // No linked resource, allow session creation for any authenticated user
      [session] = await db
        .insert(gameSessions)
        .values({
          campaignId: null,
          characterId: null,
          sessionNumber: data.sessionNumber || 1,
          status: data.status || 'active',
          startTime: new Date(),
        })
        .returning();
    }

    if (!session) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError('Campaign or Character', data.campaignId || data.characterId || 'unknown');
    }

    return session;
  }

  /**
   * Get session by ID
   */
  static async getSessionById(sessionId: string, userId: string): Promise<GameSession> {
    const session = await db.query.gameSessions.findFirst({
      where: and(
        eq(gameSessions.id, sessionId),
        this.getOwnershipCondition(userId)
      ),
    });

    if (!session) throw new NotFoundError('Session', sessionId);
    return session;
  }

  /**
   * Get session with message history
   */
  static async getSessionWithMessages(
    sessionId: string,
    userId: string,
    options?: {
      limit?: number;
      offset?: number;
    }
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
        where: and(
          eq(gameSessions.id, sessionId),
          this.getOwnershipCondition(userId)
        ),
        columns: { id: true }, // ⚡ Bolt: Only fetch ID for existence/ownership check
      }),
      db
        .select({
          message: dialogueHistory,
          totalCount: sql<number>`count(*)::int OVER()`.as('total_count'),
        })
        .from(dialogueHistory)
        .where(and(
          eq(dialogueHistory.sessionId, sessionId),
          // 🛡️ Sentinel: Incorporate ownership check directly into the dialogue history query
          // for defense-in-depth, ensuring no messages are leaked even if session check is bypassed.
          exists(
            db.select()
              .from(gameSessions)
              .where(and(
                eq(gameSessions.id, dialogueHistory.sessionId),
                this.getOwnershipCondition(userId)
              ))
          )
        ))
        .orderBy(asc(dialogueHistory.timestamp))
        .limit(limit)
        .offset(offset),
    ]);

    if (!session) throw new NotFoundError('Session', sessionId);

    return {
      session,
      messages: messagesWithCount.map((r) => r.message),
      total: messagesWithCount[0]?.totalCount || 0,
    };
  }

  /**
   * Get active session for campaign/character
   */
  static async getActiveSession(params: {
    campaignId?: string;
    characterId?: string;
  }, userId: string): Promise<GameSession | null> {
    const conditions = [isNull(gameSessions.endTime)];

    if (params.campaignId) {
      conditions.push(eq(gameSessions.campaignId, params.campaignId));
    }

    if (params.characterId) {
      conditions.push(eq(gameSessions.characterId, params.characterId));
    }

    // Add ownership check
    conditions.push(this.getOwnershipCondition(userId));

    const session = await db.query.gameSessions.findFirst({
      where: and(...conditions),
      columns: {
        id: true,
        campaignId: true,
        characterId: true,
        sessionNumber: true,
        startTime: true,
        endTime: true,
        status: true,
        turnCount: true,
        starterCampaignId: true,
        campaignVersion: true,
        ruleset: true,
        createdAt: true,
        updatedAt: true,
        // Exclude heavy fields:
        sessionNotes: false,
        currentSceneDescription: false,
        summary: false,
      },
    });

    return session || null;
  }

  /**
   * Complete/end a session
   */
  static async completeSession(
    sessionId: string,
    userId: string,
    summary?: string
  ): Promise<GameSession> {
    // ⚡ Bolt: Removed redundant getSessionById call.
    // The update query already enforces ownership via the WHERE clause.
    const [updated] = await db
      .update(gameSessions)
      .set({
        endTime: new Date(),
        status: 'completed',
        summary: summary || null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(gameSessions.id, sessionId),
        this.getOwnershipCondition(userId)
      ))
      .returning();

    if (!updated) throw new NotFoundError('Session', sessionId);
    return updated;
  }

  /**
   * Update session notes (used for session state tracking)
   */
  static async updateSessionNotes(
    sessionId: string,
    userId: string,
    notes: string
  ): Promise<GameSession> {
    // ⚡ Bolt: Removed redundant getSessionById call.
    // Ownership is verified atomically within the UPDATE query's WHERE clause.
    const [updated] = await db
      .update(gameSessions)
      .set({
        sessionNotes: notes,
        updatedAt: new Date(),
      })
      .where(and(
        eq(gameSessions.id, sessionId),
        this.getOwnershipCondition(userId)
      ))
      .returning();

    if (!updated) throw new NotFoundError('Session', sessionId);
    return updated;
  }

  /**
   * Add message to session
   */
  static async addMessage(data: {
    sessionId: string;
    speakerType: string;
    speakerId?: string;
    message: string;
    context?: Record<string, unknown>;
    images?: unknown[];
  }, userId: string): Promise<DialogueHistory> {
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    // This ensures that messages can only be added to sessions the user is authorized to access.
    const [msg] = await db
      .insert(dialogueHistory)
      .select(
        db.select({
          sessionId: sql`${data.sessionId}`,
          speakerType: sql`${data.speakerType}`,
          speakerId: sql`${data.speakerId || null}`,
          message: sql`${data.message}`,
          context: sql`${data.context || null}`,
          timestamp: sql`NOW()`,
        })
        .from(gameSessions)
        .where(and(
          eq(gameSessions.id, data.sessionId),
          this.getOwnershipCondition(userId)
        ))
      )
      .returning();

    if (!msg) throw new InternalServerError('Failed to add message');
    return msg;
  }

  /**
   * Get recent messages for session (paginated)
   */
  static async getRecentMessages(
    sessionId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<MessagePage> {
    // ⚡ Bolt: Parallelize session verification and combined message/count query to reduce total latency.
    // Reducing database round-trips from 3 to 2 by using PostgreSQL window function count(*) OVER().
    const [session, messagesWithCount] = await Promise.all([
      db.query.gameSessions.findFirst({
        where: and(
          eq(gameSessions.id, sessionId),
          this.getOwnershipCondition(userId)
        ),
        columns: { id: true }, // ⚡ Bolt: Only fetch ID for existence/ownership check
      }),
      db
        .select({
          message: dialogueHistory,
          totalCount: sql<number>`count(*)::int OVER()`.as('total_count'),
        })
        .from(dialogueHistory)
        .where(and(
          eq(dialogueHistory.sessionId, sessionId),
          // 🛡️ Sentinel: Incorporate ownership check directly into the dialogue history query
          // for defense-in-depth, ensuring no messages are leaked even if session check is bypassed.
          exists(
            db.select()
              .from(gameSessions)
              .where(and(
                eq(gameSessions.id, dialogueHistory.sessionId),
                this.getOwnershipCondition(userId)
              ))
          )
        ))
        .orderBy(desc(dialogueHistory.timestamp))
        .limit(limit)
        .offset(offset),
    ]);

    if (!session) throw new NotFoundError('Session', sessionId);

    const total = messagesWithCount[0]?.totalCount || 0;
    const hasMore = offset + limit < total;

    return {
      messages: messagesWithCount.map((r) => r.message).reverse(), // Reverse to get oldest to newest for display
      hasMore,
      total,
    };
  }

  /**
   * Get session history for campaign
   */
  static async getCampaignSessions(
    campaignId: string,
    userId: string
  ): Promise<GameSession[]> {
    // 🛡️ Sentinel: Combined campaign ownership/access and session retrieval into a single query.
    // This ensures atomic verification and masks resource existence for unauthorized users.
    // ⚡ Bolt: Optimized to exclude heavy text/JSONB fields (sessionNotes, summary, sceneDescription)
    // for list view. This reduces data transfer and memory usage.
    return await db.query.gameSessions.findMany({
      where: and(
        eq(gameSessions.campaignId, campaignId),
        this.getOwnershipCondition(userId)
      ),
      columns: {
        id: true,
        campaignId: true,
        characterId: true,
        sessionNumber: true,
        startTime: true,
        endTime: true,
        status: true,
        turnCount: true,
        starterCampaignId: true,
        campaignVersion: true,
        ruleset: true,
        createdAt: true,
        updatedAt: true,
        // Exclude heavy fields:
        sessionNotes: false,
        currentSceneDescription: false,
        summary: false,
      },
      orderBy: desc(gameSessions.sessionNumber),
    }) as GameSession[];
  }

  /**
   * Append combat log entry to session notes
   */
  static async appendCombatLog(
    sessionId: string,
    userId: string,
    entry: unknown,
    maxEntries: number = 500
  ): Promise<void> {
    // ⚡ Bolt: Optimized to fetch only the sessionNotes column instead of the entire session record.
    // This avoids over-fetching large columns like summary or currentSceneDescription.
    const session = await db.query.gameSessions.findFirst({
      where: and(
        eq(gameSessions.id, sessionId),
        this.getOwnershipCondition(userId)
      ),
      columns: { sessionNotes: true },
    });

    if (!session) throw new NotFoundError('Session', sessionId);

    // Parse existing combat log from session notes
    let combatLog: unknown[] = [];
    if (session.sessionNotes) {
      try {
        const parsed = JSON.parse(session.sessionNotes);
        combatLog = Array.isArray(parsed.combatLog) ? parsed.combatLog : [];
      } catch {
        combatLog = [];
      }
    }

    const newEntry = {
      timestamp: new Date().toISOString(),
      entry,
    };

    const merged = [...combatLog, newEntry];
    const trimmed = merged.length > maxEntries
      ? merged.slice(merged.length - maxEntries)
      : merged;

    // Store updated log back to session notes
    await this.updateSessionNotes(sessionId, userId, JSON.stringify({ combatLog: trimmed }));
  }

  /**
   * Append roll event to combat log
   */
  static async appendRollEvent(
    sessionId: string,
    userId: string,
    event: { kind: string; payload: unknown }
  ): Promise<void> {
    await this.appendCombatLog(sessionId, userId, {
      kind: event.kind,
      payload: event.payload,
    }, 500);
  }
}
