/**
 * Session Service
 *
 * Type-safe game session management using Drizzle ORM.
 * Handles session lifecycle, message history, and state management.
 */

import { eq, and, isNull, desc, asc, sql, or, exists } from 'drizzle-orm';
import { db } from '../../../db/client.js';
import { gameSessions, dialogueHistory, campaigns, characters, type GameSession, type DialogueHistory } from '../../../db/schema/index.js';
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
  private static getOwnershipCondition(userId: string) {
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
    // SECURITY: Verify ownership of campaign or character before creating session
    if (data.campaignId) {
      const campaign = await db.query.campaigns.findFirst({
        where: and(eq(campaigns.id, data.campaignId), eq(campaigns.userId, userId))
      });
      if (!campaign) throw new NotFoundError('Campaign', data.campaignId);
    }

    if (data.characterId) {
      const character = await db.query.characters.findFirst({
        where: and(
          eq(characters.id, data.characterId),
          or(eq(characters.userId, userId), eq(characters.ownerId, userId))
        )
      });
      if (!character) throw new NotFoundError('Character', data.characterId);
    }

    const [session] = await db
      .insert(gameSessions)
      .values({
        campaignId: data.campaignId || null,
        characterId: data.characterId || null,
        sessionNumber: data.sessionNumber || 1,
        status: data.status || 'active',
        startTime: new Date(),
      })
      .returning();

    if (!session) throw new InternalServerError('Failed to create session');
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

    const session = await this.getSessionById(sessionId, userId);

    // ⚡ Bolt: Parallelize message fetch and count query to reduce total latency.
    // Since sessionId and ownership are already verified, these can run concurrently.
    const [messages, countResult] = await Promise.all([
      db.query.dialogueHistory.findMany({
        where: eq(dialogueHistory.sessionId, sessionId),
        orderBy: asc(dialogueHistory.timestamp),
        limit,
        offset,
      }),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId)),
    ]);

    return {
      session,
      messages,
      total: countResult[0]?.count || 0,
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
    // Verify ownership first
    await this.getSessionById(sessionId, userId);

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

    if (!updated) throw new InternalServerError('Failed to complete session');
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
    // Verify ownership first
    await this.getSessionById(sessionId, userId);

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

    if (!updated) throw new InternalServerError('Failed to update session notes');
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
    // Verify ownership first
    await this.getSessionById(data.sessionId, userId);

    const [msg] = await db
      .insert(dialogueHistory)
      .values({
        sessionId: data.sessionId,
        speakerType: data.speakerType,
        speakerId: data.speakerId || null,
        message: data.message,
        context: data.context || null,
        timestamp: new Date(),
      })
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
    // Verify ownership first
    await this.getSessionById(sessionId, userId);

    // ⚡ Bolt: Parallelize message fetch and count query to reduce total latency.
    // Reducing database round-trips from sequential to concurrent.
    const [messages, countResult] = await Promise.all([
      db.query.dialogueHistory.findMany({
        where: eq(dialogueHistory.sessionId, sessionId),
        orderBy: desc(dialogueHistory.timestamp),
        limit,
        offset,
      }),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(dialogueHistory)
        .where(eq(dialogueHistory.sessionId, sessionId)),
    ]);

    const total = countResult[0]?.count || 0;
    const hasMore = offset + limit < total;

    return {
      messages: messages.reverse(), // Reverse to get oldest to newest for display
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
    // Verify campaign ownership
    const campaign = await db.query.campaigns.findFirst({
      where: and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId))
    });
    if (!campaign) throw new NotFoundError('Campaign', campaignId);

    return await db.query.gameSessions.findMany({
      where: eq(gameSessions.campaignId, campaignId),
      orderBy: desc(gameSessions.sessionNumber),
    });
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
    const session = await this.getSessionById(sessionId, userId);

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
    });
  }
}
