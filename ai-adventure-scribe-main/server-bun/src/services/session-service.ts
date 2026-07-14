/* eslint-disable max-lines */
/**
 * Session Service
 *
 * Type-safe game session management using Drizzle ORM.
 * Handles session lifecycle, message history, and state management.
 */

import { eq, and, desc, sql, or } from 'drizzle-orm';

import { getOwnershipCondition } from './session/session-authorization.js';
import { SessionMessageService, type MessagePage } from './session/session-message-service.js';
import { db } from '../../../db/client';
import { gameSessions, campaigns, characters, characterStats, type GameSession, type DialogueHistory } from '../../../db/schema/index';
import { NotFoundError } from '../lib/errors.js';

export { type MessagePage };

function mapSessionContextCore(session: GameSession) {
  return {
    id: session.id,
    campaign_id: session.campaignId,
    character_id: session.characterId,
    session_number: session.sessionNumber,
    start_time: session.startTime,
    end_time: session.endTime,
    status: session.status,
    current_scene_description: session.currentSceneDescription,
    summary: session.summary,
    session_notes: session.sessionNotes,
    turn_count: session.turnCount,
    starter_campaign_id: session.starterCampaignId,
    campaign_version: session.campaignVersion,
    ruleset: session.ruleset,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
  };
}

/**
 * Session Service
 * Provides type-safe database operations for game sessions and messages
 */
export class SessionService {
  /**
   * Get the joined gameplay context in one database round trip.
   * The nested response intentionally matches the legacy Supabase embed shape.
   */
  static async getSessionContext(sessionId: string, userId: string) {
    const [row] = await db
      .select({
        session: gameSessions,
        campaign: {
          id: campaigns.id,
          name: campaigns.name,
          description: campaigns.description,
        },
        character: {
          id: characters.id,
          name: characters.name,
          level: characters.level,
          race: characters.race,
          class: characters.class,
          background: characters.background,
        },
        stats: {
          strength: characterStats.strength,
          dexterity: characterStats.dexterity,
          constitution: characterStats.constitution,
          intelligence: characterStats.intelligence,
          wisdom: characterStats.wisdom,
          charisma: characterStats.charisma,
        },
      })
      .from(gameSessions)
      .innerJoin(campaigns, eq(campaigns.id, gameSessions.campaignId))
      .innerJoin(characters, eq(characters.id, gameSessions.characterId))
      .leftJoin(characterStats, eq(characterStats.characterId, characters.id))
      .where(and(eq(gameSessions.id, sessionId), getOwnershipCondition(userId)));

    if (!row) throw new NotFoundError('Session', sessionId);

    return {
      ...mapSessionContextCore(row.session),
      campaign: row.campaign,
      character: {
        ...row.character,
        character_stats: row.stats?.strength == null ? [] : [row.stats],
      },
    };
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
      where: (session, { and, eq }) =>
        and(eq(session.id, sessionId), getOwnershipCondition(userId, session)),
    });

    if (!session) throw new NotFoundError('Session', sessionId);
    return session;
  }

  /**
   * Get session with message history
   * Delegates to SessionMessageService.
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
    return SessionMessageService.getSessionWithMessages(sessionId, userId, options);
  }

  /**
   * Get active session for campaign/character
   */
  static async getActiveSession(params: {
    campaignId?: string;
    characterId?: string;
  }, userId: string): Promise<GameSession | null> {
    const session = await db.query.gameSessions.findFirst({
      where: (session, { and, eq, isNull }) =>
        and(
          isNull(session.endTime),
          params.campaignId ? eq(session.campaignId, params.campaignId) : undefined,
          params.characterId ? eq(session.characterId, params.characterId) : undefined,
          getOwnershipCondition(userId, session),
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
        getOwnershipCondition(userId)
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
        getOwnershipCondition(userId)
      ))
      .returning();

    if (!updated) throw new NotFoundError('Session', sessionId);
    return updated;
  }

  /**
   * Add message to session
   * Delegates to SessionMessageService.
   */
  static async addMessage(data: {
    sessionId: string;
    speakerType: string;
    speakerId?: string;
    message: string;
    context?: Record<string, unknown>;
    images?: unknown[];
  }, userId: string): Promise<DialogueHistory> {
    return SessionMessageService.addMessage(data, userId);
  }

  /**
   * Get recent messages for session (paginated)
   * Delegates to SessionMessageService.
   */
  static async getRecentMessages(
    sessionId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<MessagePage> {
    return SessionMessageService.getRecentMessages(sessionId, userId, limit, offset);
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
      where: (session, { and, eq }) =>
        and(
          eq(session.campaignId, campaignId),
          getOwnershipCondition(userId, session),
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
      where: (session, { and, eq }) =>
        and(eq(session.id, sessionId), getOwnershipCondition(userId, session)),
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
