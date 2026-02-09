/**
 * Session Service
 *
 * Type-safe game session management using Drizzle ORM.
 * Handles session lifecycle, message history, and state management.
 */

import { eq, and, isNull, desc, asc, sql, or } from 'drizzle-orm';

import { db } from '../../../db/client.js';
import {
  gameSessions,
  dialogueHistory,
  campaigns,
  characters,
  type GameSession,
  type DialogueHistory,
} from '../../../db/schema/index.js';
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
   * Validate campaign visibility for the current user.
   */
  private static async assertCampaignAccess(campaignId: string, userId: string): Promise<void> {
    const [campaign] = await db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
      .limit(1);

    if (!campaign) {
      throw new NotFoundError('Campaign', campaignId);
    }
  }

  /**
   * Validate character visibility for the current user.
   */
  private static async assertCharacterAccess(characterId: string, userId: string): Promise<void> {
    const [character] = await db
      .select({ id: characters.id })
      .from(characters)
      .where(and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId))
      ))
      .limit(1);

    if (!character) {
      throw new NotFoundError('Character', characterId);
    }
  }

  /**
   * Validate campaign/character session context for the current user.
   */
  private static async assertSessionContextAccess(
    params: { campaignId?: string | null; characterId?: string | null },
    userId: string
  ): Promise<void> {
    if (params.campaignId) {
      await this.assertCampaignAccess(params.campaignId, userId);
    }

    if (params.characterId) {
      await this.assertCharacterAccess(params.characterId, userId);
    }
  }

  /**
   * Resolve a session only when the user can access it through campaign/character ownership.
   */
  private static async getAccessibleSession(
    sessionId: string,
    userId: string
  ): Promise<GameSession | undefined> {
    const [result] = await db
      .select({ session: gameSessions })
      .from(gameSessions)
      .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
      .leftJoin(characters, eq(gameSessions.characterId, characters.id))
      .where(and(
        eq(gameSessions.id, sessionId),
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId)
        )
      ))
      .limit(1);

    return result?.session;
  }

  /**
   * Throw NOT_FOUND when a session is missing or inaccessible.
   */
  private static async assertSessionAccess(sessionId: string, userId: string): Promise<void> {
    const session = await this.getAccessibleSession(sessionId, userId);
    if (!session) {
      throw new NotFoundError('Session', sessionId);
    }
  }

  /**
   * Create a new game session
   */
  static async createSession(data: {
    campaignId?: string | null;
    characterId?: string | null;
    sessionNumber?: number;
    status?: string;
  }, userId?: string): Promise<GameSession> {
    if (userId) {
      await this.assertSessionContextAccess(
        { campaignId: data.campaignId, characterId: data.characterId },
        userId
      );
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
  static async getSessionById(sessionId: string, userId?: string): Promise<GameSession | undefined> {
    if (userId) {
      return this.getAccessibleSession(sessionId, userId);
    }

    return await db.query.gameSessions.findFirst({
      where: eq(gameSessions.id, sessionId),
    });
  }

  /**
   * Get session with message history
   */
  static async getSessionWithMessages(
    sessionId: string,
    options?: {
      limit?: number;
      offset?: number;
    },
    userId?: string
  ): Promise<{
    session: GameSession | undefined;
    messages: DialogueHistory[];
    total: number;
  }> {
    const limit = options?.limit || 50;
    const offset = options?.offset || 0;

    const session = await this.getSessionById(sessionId, userId);

    if (!session) {
      return { session: undefined, messages: [], total: 0 };
    }

    // Get messages with pagination
    const messages = await db.query.dialogueHistory.findMany({
      where: eq(dialogueHistory.sessionId, sessionId),
      orderBy: asc(dialogueHistory.timestamp),
      limit,
      offset,
    });

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, sessionId));

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
  }, userId?: string): Promise<GameSession | undefined> {
    if (userId) {
      await this.assertSessionContextAccess(
        { campaignId: params.campaignId, characterId: params.characterId },
        userId
      );

      const conditions = [
        isNull(gameSessions.endTime),
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId)
        ),
      ];

      if (params.campaignId) {
        conditions.push(eq(gameSessions.campaignId, params.campaignId));
      }

      if (params.characterId) {
        conditions.push(eq(gameSessions.characterId, params.characterId));
      }

      const [result] = await db
        .select({ session: gameSessions })
        .from(gameSessions)
        .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .leftJoin(characters, eq(gameSessions.characterId, characters.id))
        .where(and(...conditions))
        .limit(1);

      return result?.session;
    }

    const conditions = [isNull(gameSessions.endTime)];

    if (params.campaignId) {
      conditions.push(eq(gameSessions.campaignId, params.campaignId));
    }

    if (params.characterId) {
      conditions.push(eq(gameSessions.characterId, params.characterId));
    }

    return await db.query.gameSessions.findFirst({
      where: and(...conditions),
    });
  }

  /**
   * Complete/end a session
   */
  static async completeSession(
    sessionId: string,
    summary?: string,
    userId?: string
  ): Promise<GameSession> {
    if (userId) {
      await this.assertSessionAccess(sessionId, userId);
    }

    const [updated] = await db
      .update(gameSessions)
      .set({
        endTime: new Date(),
        status: 'completed',
        summary: summary || null,
        updatedAt: new Date(),
      })
      .where(eq(gameSessions.id, sessionId))
      .returning();

    if (!updated && userId) {
      throw new NotFoundError('Session', sessionId);
    }
    if (!updated) throw new InternalServerError('Failed to complete session');
    return updated;
  }

  /**
   * Update session notes (used for session state tracking)
   */
  static async updateSessionNotes(
    sessionId: string,
    notes: string,
    userId?: string
  ): Promise<GameSession> {
    if (userId) {
      await this.assertSessionAccess(sessionId, userId);
    }

    const [updated] = await db
      .update(gameSessions)
      .set({
        sessionNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(gameSessions.id, sessionId))
      .returning();

    if (!updated && userId) {
      throw new NotFoundError('Session', sessionId);
    }
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
  }, userId?: string): Promise<DialogueHistory> {
    if (userId) {
      await this.assertSessionAccess(data.sessionId, userId);
    }

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
    limit: number = 50,
    offset: number = 0,
    userId?: string
  ): Promise<MessagePage> {
    if (userId) {
      await this.assertSessionAccess(sessionId, userId);
    }

    // Get messages ordered by timestamp (newest first for pagination)
    const messages = await db.query.dialogueHistory.findMany({
      where: eq(dialogueHistory.sessionId, sessionId),
      orderBy: desc(dialogueHistory.timestamp),
      limit,
      offset,
    });

    // Get total count
    const countResult = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(dialogueHistory)
      .where(eq(dialogueHistory.sessionId, sessionId));

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
    userId?: string
  ): Promise<GameSession[]> {
    if (userId) {
      const rows = await db
        .select({ session: gameSessions })
        .from(gameSessions)
        .innerJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .where(and(eq(gameSessions.campaignId, campaignId), eq(campaigns.userId, userId)))
        .orderBy(desc(gameSessions.sessionNumber));

      return rows.map((row) => row.session);
    }

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
    entry: unknown,
    maxEntries: number = 500,
    userId?: string
  ): Promise<void> {
    const session = await this.getSessionById(sessionId, userId);
    if (!session) return;

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
    await this.updateSessionNotes(sessionId, JSON.stringify({ combatLog: trimmed }), userId);
  }

  /**
   * Append roll event to combat log
   */
  static async appendRollEvent(
    sessionId: string,
    event: { kind: string; payload: unknown },
    userId?: string
  ): Promise<void> {
    await this.appendCombatLog(sessionId, {
      kind: event.kind,
      payload: event.payload,
    }, 500, userId);
  }
}
