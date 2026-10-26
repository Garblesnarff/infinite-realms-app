/* eslint-disable max-lines */
/**
 * Session Service
 *
 * Type-safe game session management using Drizzle ORM.
 * Handles session lifecycle, message history, and state management.
 */

import { eq, and, desc, sql, or, type SQL } from 'drizzle-orm';

import { ClassFeaturesService } from './class-features-service.js';
import { actionSurgePreservingState } from './combat/combat-turn-resources.js';
import { enginePreservingSessionState } from './combat/pending-combat-entry.js';
import { trackerPreservingState } from './dm/story-tracker.js';
import { pendingEndingXpPreservingState } from './dm/story-xp.js';
import { getOwnershipCondition } from './session/session-authorization.js';
import { SessionMessageService, type MessagePage } from './session/session-message-service.js';
import { db } from '../../../db/client';
import {
  gameSessions,
  campaigns,
  characters,
  characterSpells,
  characterStats,
  sessionChronicles,
  spells,
  type GameSession,
  type DialogueHistory,
} from '../../../db/schema/index';
import { mapSessionListApiRow } from '../../../shared/session-list-contract.js';
import { resolveCatalogSpell } from '../data/spellData.js';
import { NotFoundError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

type ActiveSession = Omit<
  GameSession,
  'sessionNotes' | 'currentSceneDescription' | 'summary' | 'sessionState'
>;

export { type MessagePage };

interface CreateSessionData {
  campaignId?: string | null;
  characterId?: string | null;
  sessionNumber?: number;
  status?: string;
  summary?: string | null;
  currentSceneDescription?: string | null;
  sessionNotes?: string | null;
  turnCount?: number;
  starterCampaignId?: string | null;
  campaignVersion?: number | null;
}

/**
 * Build the row inserted by createSession.
 *
 * This used to build the SELECT list for an ownership-gated INSERT ... SELECT, and
 * had to restate every game_sessions column -- including the ones the table already
 * defaults -- in table-definition order, because that is what Drizzle's insert-select
 * validates against. Adding a column to game_sessions without adding it here broke
 * session creation entirely, at runtime only. Now that the ownership check is a
 * separate query, this is a plain values object and column defaults do their job.
 */
export function buildSessionInsertValues(
  data: CreateSessionData,
  ids: { campaignId: string | null; characterId: string | null },
) {
  return {
    campaignId: ids.campaignId,
    characterId: ids.characterId,
    sessionNumber: data.sessionNumber || 1,
    startTime: new Date(),
    endTime: null,
    status: data.status || 'active',
    currentSceneDescription: data.currentSceneDescription ?? null,
    summary: data.summary ?? null,
    sessionNotes: data.sessionNotes ?? null,
    turnCount: data.turnCount ?? 0,
    sessionState: {},
    starterCampaignId: data.starterCampaignId ?? null,
    campaignVersion: data.campaignVersion ?? null,
    ruleset: '5e',
  };
}

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
 * The class features the DM prompt may credit this character with (#217): the same
 * membership the DM feature gate enforces after the turn — `class_features_library` for
 * the character's class, cumulative to their level, plus any features granted to the
 * character. Returns null when no authoritative list exists: the gate does not rule on
 * a multiclass character (only one class is read), on a classless character, or on a
 * class the library does not cover, and a false refusal is worse than a missed one —
 * so the prompt must make no claim either. Null, not an empty list: an empty list
 * asserts "this character has no features", a stronger and different statement.
 */
async function sessionCharacterFeatureNames(
  character: { id: string; class: string | null; level: number; classLevels: unknown },
  userId: string,
): Promise<string[] | null> {
  if (!character.class) return null;
  if (Array.isArray(character.classLevels) && character.classLevels.length > 1) return null;
  const library = await ClassFeaturesService.getFeaturesLibrary();
  const className = character.class.toLowerCase();
  if (!library.some((feature) => feature.className.toLowerCase() === className)) return null;
  const names = new Set<string>();
  for (const feature of library) {
    if (
      feature.className.toLowerCase() === className &&
      feature.levelAcquired <= character.level
    ) {
      names.add(feature.featureName);
    }
  }
  const grantedIds = new Set(
    (await ClassFeaturesService.getCharacterFeatures(character.id, userId)).map(
      (row) => row.featureId,
    ),
  );
  for (const feature of library) {
    if (grantedIds.has(feature.id)) names.add(feature.featureName);
  }
  return [...names];
}

/**
 * The character's spell lists for the DM prompt (#217): the same union the feature
 * gate's `castableSpells` reads — the character row's text columns plus the
 * `character_spells` rows, because the preparation toggle writes only the junction
 * table, so the columns alone go stale the day a caster re-prepares. Column entries
 * are resolved through the spell catalog, so a slug a producer stored
 * ('arms-of-hadar') prints as the spell's name, the way the gate reads it. Returned
 * as the comma-separated strings the payload has always carried, deduped.
 */
async function sessionCharacterSpellLists(character: {
  id: string;
  cantrips: string | null;
  knownSpells: string | null;
  preparedSpells: string | null;
  ritualSpells: string | null;
}): Promise<{ cantrips: string; knownSpells: string; preparedSpells: string; ritualSpells: string }> {
  const listed = (value: string | null): string[] =>
    (value ?? '')
      .split(',')
      .map((ref) => ref.trim())
      .filter(Boolean)
      .map((ref) => resolveCatalogSpell(ref, ref)?.name ?? ref);
  const rows = await db
    .select({
      name: spells.name,
      level: spells.level,
      ritual: spells.ritual,
      isPrepared: characterSpells.isPrepared,
      isAlwaysPrepared: characterSpells.isAlwaysPrepared,
    })
    .from(characterSpells)
    .innerJoin(spells, eq(characterSpells.spellId, spells.id))
    .where(eq(characterSpells.characterId, character.id));
  const merge = (names: string[]): string => [...new Set(names)].join(', ');
  return {
    cantrips: merge([
      ...listed(character.cantrips),
      ...rows.filter((row) => row.level === 0).map((row) => row.name),
    ]),
    preparedSpells: merge([
      ...listed(character.preparedSpells),
      ...rows
        .filter((row) => row.isPrepared !== false || row.isAlwaysPrepared)
        .map((row) => row.name),
    ]),
    knownSpells: merge([...listed(character.knownSpells), ...rows.map((row) => row.name)]),
    ritualSpells: merge([
      ...listed(character.ritualSpells),
      ...rows.filter((row) => row.ritual).map((row) => row.name),
    ]),
  };
}

/**
 * Session Service
 * Provides type-safe database operations for game sessions and messages
 */
export class SessionService {
  /**
   * Get the joined gameplay context.
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
          // #1020: the client gates a completed session's end state on the
          // campaign being a one-shot, read in this same load payload.
          campaignLength: campaigns.campaignLength,
        },
        character: {
          id: characters.id,
          name: characters.name,
          level: characters.level,
          race: characters.race,
          class: characters.class,
          background: characters.background,
          // #217: the DM prompt is built from this payload, and until now it carried no
          // features and no spells, so the DM granted both from its mood. These columns
          // are the raw sheet values; the payload's lists are computed below (the spell
          // columns merged with the character's spell rows, the features resolved).
          cantrips: characters.cantrips,
          knownSpells: characters.knownSpells,
          preparedSpells: characters.preparedSpells,
          ritualSpells: characters.ritualSpells,
          classLevels: characters.classLevels,
        },
        stats: {
          strength: characterStats.strength,
          dexterity: characterStats.dexterity,
          constitution: characterStats.constitution,
          intelligence: characterStats.intelligence,
          wisdom: characterStats.wisdom,
          charisma: characterStats.charisma,
          max_hit_points: characterStats.maxHitPoints,
          current_hit_points: characterStats.currentHitPoints,
          // #2517: the single truth for "dead". The client gates the game
          // screen on this in the session load payload, so a fallen
          // character's end state renders instead of the composer.
          vital_state: characterStats.vitalState,
          died_at: characterStats.diedAt,
        },
      })
      .from(gameSessions)
      .innerJoin(campaigns, eq(campaigns.id, gameSessions.campaignId))
      .innerJoin(characters, eq(characters.id, gameSessions.characterId))
      .leftJoin(characterStats, eq(characterStats.characterId, characters.id))
      .where(and(eq(gameSessions.id, sessionId), getOwnershipCondition(userId)));

    if (!row) throw new NotFoundError('Session', sessionId);

    // #217: the prompt enrichment rides along on this load, and it is cosmetics —
    // it must never fail the load itself. Like the gate it mirrors, it fails open:
    // a character whose lists cannot be built loads with no feature claim
    // (featureNames null) and the sheet's raw spell columns.
    let featureNames: string[] | null = null;
    let spellLists: {
      cantrips: string | null;
      knownSpells: string | null;
      preparedSpells: string | null;
      ritualSpells: string | null;
    } = {
      cantrips: row.character.cantrips,
      knownSpells: row.character.knownSpells,
      preparedSpells: row.character.preparedSpells,
      ritualSpells: row.character.ritualSpells,
    };
    try {
      featureNames = await sessionCharacterFeatureNames(row.character, userId);
      spellLists = await sessionCharacterSpellLists(row.character);
    } catch (error) {
      logger.warn({
        msg: 'SESSION_CONTEXT_ENRICHMENT_SKIPPED',
        sessionId,
        err: error instanceof Error ? error.message : String(error),
      });
    }

    // classLevels was selected only for the multiclass check above; it is not part
    // of the payload the client has ever received, so it stays server-side.
    const { classLevels: _classLevels, ...characterRow } = row.character;
    return {
      ...mapSessionContextCore(row.session),
      campaign: row.campaign,
      character: {
        ...characterRow,
        ...spellLists,
        character_stats: row.stats?.strength == null ? [] : [row.stats],
        featureNames,
      },
    };
  }

  /**
   * Create a new game session
   */
  static async createSession(data: CreateSessionData, userId: string): Promise<GameSession> {
    // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
    // This ensures that sessions can only be created for campaigns or characters the user is authorized to access
    // while masking resource existence in a single atomic database round-trip.
    let session: GameSession | undefined;

    if (data.campaignId && data.characterId) {
      // Only one active session may exist per campaign+character
      // (idx_active_session_per_character partial unique index). Creating a new
      // active session is an explicit "start fresh", so retire any lingering
      // active session for this pair first — otherwise the INSERT fails.
      if ((data.status || 'active') === 'active') {
        await db
          .update(gameSessions)
          .set({ status: 'completed', endTime: new Date(), updatedAt: new Date() })
          .where(
            and(
              eq(gameSessions.campaignId, data.campaignId),
              eq(gameSessions.characterId, data.characterId),
              eq(gameSessions.status, 'active'),
              getOwnershipCondition(userId),
            ),
          );
      }

      // Each branch is now: run the branch's ownership query, then insert. The WHERE
      // clauses are carried over unchanged -- only the insert-select wrapper is gone.
      const owned = await db
        .select({ one: sql`1` })
        .from(campaigns)
        .innerJoin(characters, eq(characters.id, data.characterId))
        .where(
          and(
            eq(campaigns.id, data.campaignId),
            eq(campaigns.userId, userId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          ),
        )
        .limit(1);

      if (owned.length > 0) {
        [session] = await db
          .insert(gameSessions)
          .values(
            buildSessionInsertValues(data, {
              campaignId: data.campaignId,
              characterId: data.characterId,
            }),
          )
          .returning();
      }
    } else if (data.campaignId) {
      const owned = await db
        .select({ one: sql`1` })
        .from(campaigns)
        .where(and(eq(campaigns.id, data.campaignId), eq(campaigns.userId, userId)))
        .limit(1);

      if (owned.length > 0) {
        [session] = await db
          .insert(gameSessions)
          .values(
            buildSessionInsertValues(data, {
              campaignId: data.campaignId,
              characterId: null,
            }),
          )
          .returning();
      }
    } else if (data.characterId) {
      const owned = await db
        .select({ one: sql`1` })
        .from(characters)
        .where(
          and(
            eq(characters.id, data.characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
          ),
        )
        .limit(1);

      if (owned.length > 0) {
        [session] = await db
          .insert(gameSessions)
          .values(
            buildSessionInsertValues(data, {
              campaignId: null,
              characterId: data.characterId,
            }),
          )
          .returning();
      }
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
          summary: data.summary,
          currentSceneDescription: data.currentSceneDescription,
          sessionNotes: data.sessionNotes,
          turnCount: data.turnCount,
          starterCampaignId: data.starterCampaignId,
          campaignVersion: data.campaignVersion,
        })
        .returning();
    }

    if (!session) {
      // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
      throw new NotFoundError(
        'Campaign or Character',
        data.campaignId || data.characterId || 'unknown',
      );
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

  static async listSessions(
    filters: {
      campaignId?: string;
      characterId?: string;
      status?: string;
      starterOnly?: boolean;
      limit?: number;
      offset?: number;
    },
    userId: string,
  ) {
    const conditions: SQL[] = [getOwnershipCondition(userId) as SQL];
    if (filters.campaignId) conditions.push(eq(gameSessions.campaignId, filters.campaignId));
    if (filters.characterId) conditions.push(eq(gameSessions.characterId, filters.characterId));
    if (filters.status) conditions.push(eq(gameSessions.status, filters.status));
    if (filters.starterOnly) conditions.push(sql`${gameSessions.starterCampaignId} IS NOT NULL`);

    const rows = await db
      .select({
        session: gameSessions,
        character: { id: characters.id, name: characters.name, image_url: characters.imageUrl },
        chronicle: {
          id: sessionChronicles.id,
          status: sessionChronicles.status,
          chapter_title: sessionChronicles.chapterTitle,
          share_token: sessionChronicles.shareToken,
        },
      })
      .from(gameSessions)
      .leftJoin(characters, eq(characters.id, gameSessions.characterId))
      .leftJoin(sessionChronicles, eq(sessionChronicles.sessionId, gameSessions.id))
      .where(and(...conditions))
      .orderBy(desc(gameSessions.createdAt))
      .limit(Math.min(filters.limit ?? 50, 100))
      .offset(filters.offset ?? 0);

    return rows.map((row) =>
      mapSessionListApiRow(
        row.session,
        row.character?.id ? row.character : null,
        row.chronicle?.id ? [row.chronicle] : [],
      ),
    );
  }

  static async updateSession(
    sessionId: string,
    userId: string,
    updates: Partial<
      Pick<
        GameSession,
        | 'status'
        | 'summary'
        | 'currentSceneDescription'
        | 'sessionNotes'
        | 'turnCount'
        | 'sessionState'
        | 'starterCampaignId'
        | 'campaignVersion'
        | 'endTime'
      >
    >,
  ): Promise<GameSession> {
    // #975: a client `session_state` write replaces the whole blob, but the
    // Action Surge mark inside it is engine-owned — the stored value of that
    // key wins over the client's snapshot, so a stale snapshot can neither
    // delete a live mark nor resurrect a spent one. #913 adds the pending
    // combat entry to that same merge, and #1042 the story-tracker state
    // (climax phase, safety-net count, once-per-message marker). #1139 adds
    // the deferred ending award to that same merge. The merge
    // is folded into the UPDATE itself (enginePreservingSessionState)
    // rather than read first: a separate read would let an arm or a
    // consume committing between the two statements be undone by this
    // write.
    const [updated] = await db
      .update(gameSessions)
      .set({
        ...updates,
        ...(updates.sessionState !== undefined
          ? {
              sessionState: pendingEndingXpPreservingState(
                trackerPreservingState(
                  enginePreservingSessionState(actionSurgePreservingState(updates.sessionState)),
                ),
              ),
            }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(gameSessions.id, sessionId), getOwnershipCondition(userId)))
      .returning();
    if (!updated) throw new NotFoundError('Session', sessionId);
    return updated;
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
    },
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
  static async getActiveSession(
    params: {
      campaignId?: string;
      characterId?: string;
    },
    userId: string,
  ): Promise<ActiveSession | null> {
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
    summary?: string,
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
      .where(and(eq(gameSessions.id, sessionId), getOwnershipCondition(userId)))
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
    notes: string,
  ): Promise<GameSession> {
    // ⚡ Bolt: Removed redundant getSessionById call.
    // Ownership is verified atomically within the UPDATE query's WHERE clause.
    const [updated] = await db
      .update(gameSessions)
      .set({
        sessionNotes: notes,
        updatedAt: new Date(),
      })
      .where(and(eq(gameSessions.id, sessionId), getOwnershipCondition(userId)))
      .returning();

    if (!updated) throw new NotFoundError('Session', sessionId);
    return updated;
  }

  /**
   * Get recent messages for session (paginated)
   * Delegates to SessionMessageService.
   */
  static async getRecentMessages(
    sessionId: string,
    userId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<MessagePage> {
    return SessionMessageService.getRecentMessages(sessionId, userId, limit, offset);
  }

  /**
   * Get session history for campaign
   */
  static async getCampaignSessions(campaignId: string, userId: string): Promise<GameSession[]> {
    // 🛡️ Sentinel: Combined campaign ownership/access and session retrieval into a single query.
    // This ensures atomic verification and masks resource existence for unauthorized users.
    // ⚡ Bolt: Optimized to exclude heavy text/JSONB fields (sessionNotes, summary, sceneDescription)
    // for list view. This reduces data transfer and memory usage.
    return (await db.query.gameSessions.findMany({
      where: (session, { and, eq }) =>
        and(eq(session.campaignId, campaignId), getOwnershipCondition(userId, session)),
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
    })) as GameSession[];
  }

  /**
   * Append combat log entry to session notes
   */
  static async appendCombatLog(
    sessionId: string,
    userId: string,
    entry: unknown,
    maxEntries: number = 500,
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
    const trimmed = merged.length > maxEntries ? merged.slice(merged.length - maxEntries) : merged;

    // Store updated log back to session notes
    await this.updateSessionNotes(sessionId, userId, JSON.stringify({ combatLog: trimmed }));
  }

  /**
   * Append roll event to combat log
   */
  static async appendRollEvent(
    sessionId: string,
    userId: string,
    event: { kind: string; payload: unknown },
  ): Promise<void> {
    await this.appendCombatLog(
      sessionId,
      userId,
      {
        kind: event.kind,
        payload: event.payload,
      },
      500,
    );
  }
}
