/* eslint-disable max-lines */
import { and, asc, desc, eq, gt, inArray, isNull, ne, or } from 'drizzle-orm';

import {
  calculateCompanionRollModifier,
  type CompanionRollKind,
  type StoredRollCharacter,
  type StoredRollStats,
} from './companion-roll.js';
import { db } from '../../../../db/client';
import {
  campaigns,
  characterConditions,
  characterStats,
  characters,
  conditionsLibrary,
  dialogueHistory,
  gameSessions,
  sessionCompanions,
  npcs,
  type Character,
  type CharacterStats,
  type DialogueHistory,
  type SessionCompanion,
} from '../../../../db/schema/index';
import { rollD20 } from '../../lib/dice.js';
import {
  BusinessLogicError,
  InternalServerError,
  NotFoundError,
  ValidationError,
} from '../../lib/errors.js';
import { CombatEncounterService } from '../combat/combat-encounter-service.js';

import type { CombatParticipant as ServerCombatParticipant } from '../../types/combat.js';

export const MAX_SESSION_COMPANIONS = 2;
export const COMPANION_TEXT_MAX_LENGTH = 1200;

export interface CompanionPublicRow {
  id: string;
  session_id: string;
  character_id: string;
  controller: string;
  status: string;
  created_at: Date | null;
}

export interface PartyRosterMember {
  name: string;
  class: string | null;
  race: string | null;
  level: number;
  current_hp: number | null;
  max_hp: number | null;
  conditions: string[];
  armor_class: number | null;
}

export interface CompanionRollRequest {
  kind: CompanionRollKind;
  name: string;
  reason?: string;
}

export interface CompanionRollResult {
  d20: number;
  modifier: number;
  total: number;
  breakdown: string[];
}

export interface RedactedCombatParticipant {
  name: string;
  side: 'party' | 'enemy';
  hp_tier?: 'healthy' | 'bloodied' | 'critical';
  current_hp?: number;
  max_hp?: number;
}

export interface RedactedCombat {
  round: number;
  turn_order: string[];
  current_turn_name: string | null;
  participants: RedactedCombatParticipant[];
  your_companion_participant_id: string | null;
}

export interface RedactedScene {
  campaign: { name: string | null; description: string | null };
  session: {
    current_scene_description: string | null;
    summary: string | null;
  };
  party: PartyRosterMember[];
  dialogue_history: Array<{
    speaker_type: string | null;
    speaker_name: string | null;
    text: string;
  }>;
  combat: RedactedCombat | null;
}

export type SceneBaseRow = {
  sessionId: string;
  currentSceneDescription: string | null;
  summary: string | null;
  campaignName: string | null;
  campaignDescription: string | null;
  mainCharacterId: string | null;
  mainName: string | null;
  mainClass: string | null;
  mainRace: string | null;
  mainLevel: number | null;
  mainCurrentHp: number | null;
  mainMaxHp: number | null;
  mainArmorClass: number | null;
};

export type CompanionPartyRow = {
  id: string;
  characterId: string;
  name: string;
  class: string | null;
  race: string | null;
  level: number;
  currentHp: number | null;
  maxHp: number | null;
  armorClass: number | null;
  createdAt: Date | null;
};

export interface SceneDialogueRow {
  speakerType: string | null;
  speakerName: string | null;
  npcSpeakerName: string | null;
  text: string;
}

type OwnedCompanionRow = {
  companion: SessionCompanion;
  character: Character;
  stats: CharacterStats | null;
};

type CombatParticipantWithStatus = ServerCombatParticipant & {
  id: string;
  characterId: string | null;
  name: string;
  participantType: string;
  isActive: boolean;
  turnOrder: number;
  maxHp: number;
  status?: {
    currentHp?: number | null;
    maxHp?: number | null;
    isConscious?: boolean | null;
  } | null;
};

const sessionOwnerPredicate = (userId: string) =>
  or(eq(campaigns.userId, userId), eq(characters.userId, userId), eq(characters.ownerId, userId));

const characterOwnerPredicate = (userId: string) =>
  or(eq(characters.userId, userId), eq(characters.ownerId, userId));

export function mapCompanion(companion: SessionCompanion): CompanionPublicRow {
  return {
    id: companion.id,
    session_id: companion.sessionId,
    character_id: companion.characterId,
    controller: companion.controller,
    status: companion.status,
    created_at: companion.createdAt,
  };
}

export function sanitizeCompanionText(text: string): string {
  return text
    .replace(/\[ASSET:[^\]]*(?:\]|$)/gi, '')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .slice(0, COMPANION_TEXT_MAX_LENGTH);
}

export function hpTier(currentHp: number, maxHp: number): 'healthy' | 'bloodied' | 'critical' {
  if (currentHp <= 0 || maxHp <= 0) return 'critical';
  if (currentHp > maxHp / 2) return 'healthy';
  if (currentHp > maxHp / 4) return 'bloodied';
  return 'critical';
}

export interface SceneProjectionInput {
  base: SceneBaseRow;
  companions: CompanionPartyRow[];
  conditions: Map<string, string[]>;
  dialogueRows: SceneDialogueRow[];
  combatState: Parameters<typeof redactCombatState>[0] | null;
  requestingCompanionCharacterId: string | null;
}

function conditionsByCharacter(rows: Array<{ characterId: string; name: string }>) {
  const result = new Map<string, string[]>();
  for (const row of rows) {
    const conditions = result.get(row.characterId) ?? [];
    conditions.push(row.name);
    result.set(row.characterId, conditions);
  }
  return result;
}

async function loadConditions(characterIds: string[]): Promise<Map<string, string[]>> {
  if (characterIds.length === 0) return new Map();
  const rows = await db
    .select({ characterId: characterConditions.characterId, name: conditionsLibrary.name })
    .from(characterConditions)
    .innerJoin(conditionsLibrary, eq(characterConditions.conditionId, conditionsLibrary.id))
    .where(
      and(
        inArray(characterConditions.characterId, characterIds),
        eq(characterConditions.isActive, true),
        or(isNull(characterConditions.expiresAt), gt(characterConditions.expiresAt, new Date())),
      ),
    );
  return conditionsByCharacter(rows);
}

async function loadSceneBase(sessionId: string, userId: string): Promise<SceneBaseRow> {
  const [row] = await db
    .select({
      sessionId: gameSessions.id,
      currentSceneDescription: gameSessions.currentSceneDescription,
      summary: gameSessions.summary,
      campaignName: campaigns.name,
      campaignDescription: campaigns.description,
      mainCharacterId: characters.id,
      mainName: characters.name,
      mainClass: characters.class,
      mainRace: characters.race,
      mainLevel: characters.level,
      mainCurrentHp: characterStats.currentHitPoints,
      mainMaxHp: characterStats.maxHitPoints,
      mainArmorClass: characterStats.armorClass,
    })
    .from(gameSessions)
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .leftJoin(characterStats, eq(characters.id, characterStats.characterId))
    .where(and(eq(gameSessions.id, sessionId), sessionOwnerPredicate(userId)))
    .limit(1);

  if (!row) throw new NotFoundError('Session', sessionId);
  return row;
}

async function loadActiveCompanionPartyRows(sessionId: string): Promise<CompanionPartyRow[]> {
  return db
    .select({
      id: sessionCompanions.id,
      characterId: characters.id,
      name: characters.name,
      class: characters.class,
      race: characters.race,
      level: characters.level,
      currentHp: characterStats.currentHitPoints,
      maxHp: characterStats.maxHitPoints,
      armorClass: characterStats.armorClass,
      createdAt: sessionCompanions.createdAt,
    })
    .from(sessionCompanions)
    .innerJoin(characters, eq(sessionCompanions.characterId, characters.id))
    .leftJoin(characterStats, eq(characters.id, characterStats.characterId))
    .where(and(eq(sessionCompanions.sessionId, sessionId), eq(sessionCompanions.status, 'active')))
    .orderBy(asc(sessionCompanions.createdAt), asc(sessionCompanions.id));
}

function buildPartyRoster(
  base: SceneBaseRow,
  companions: CompanionPartyRow[],
  conditions: Map<string, string[]>,
): PartyRosterMember[] {
  const party: PartyRosterMember[] = [];
  if (base.mainCharacterId && base.mainName) {
    party.push({
      name: base.mainName,
      class: base.mainClass,
      race: base.mainRace,
      level: base.mainLevel ?? 1,
      current_hp: base.mainCurrentHp,
      max_hp: base.mainMaxHp,
      conditions: conditions.get(base.mainCharacterId) ?? [],
      armor_class: base.mainArmorClass,
    });
  }
  for (const companion of companions) {
    party.push({
      name: companion.name,
      class: companion.class,
      race: companion.race,
      level: companion.level,
      current_hp: companion.currentHp,
      max_hp: companion.maxHp,
      conditions: conditions.get(companion.characterId) ?? [],
      armor_class: companion.armorClass,
    });
  }
  return party;
}

async function loadOwnedCompanion(
  sessionId: string,
  companionId: string,
  userId: string,
): Promise<OwnedCompanionRow> {
  const [row] = await db
    .select({ companion: sessionCompanions, character: characters, stats: characterStats })
    .from(sessionCompanions)
    .innerJoin(characters, eq(sessionCompanions.characterId, characters.id))
    .leftJoin(characterStats, eq(characters.id, characterStats.characterId))
    .where(
      and(
        eq(sessionCompanions.id, companionId),
        eq(sessionCompanions.sessionId, sessionId),
        eq(sessionCompanions.status, 'active'),
        characterOwnerPredicate(userId),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError('Companion', companionId);
  return row;
}

async function insertCompanionTranscript(
  sessionId: string,
  speakerId: string | null,
  message: string,
  context: Record<string, unknown>,
): Promise<DialogueHistory> {
  const [inserted] = await db
    .insert(dialogueHistory)
    .values({
      sessionId,
      speakerType: context.source === 'companion' ? 'companion' : 'system',
      speakerId,
      message,
      context,
    })
    .returning();
  if (!inserted) throw new InternalServerError('Failed to write companion transcript');
  return inserted;
}

export function buildCompanionRollTranscript(
  characterName: string,
  request: CompanionRollRequest,
  result: CompanionRollResult,
): string {
  const reason = request.reason ? ` — ${request.reason}` : '';
  return `⚙️ Engine: ${characterName} rolled ${request.name} (${request.kind}): d20 ${result.d20} ${result.modifier >= 0 ? '+' : ''}${result.modifier} = ${result.total} [${result.breakdown.slice(1).join(', ')}]${reason}`;
}

export function buildRedactedScene(input: SceneProjectionInput): RedactedScene {
  const {
    base,
    companions,
    conditions,
    dialogueRows,
    combatState,
    requestingCompanionCharacterId,
  } = input;
  return {
    campaign: { name: base.campaignName, description: base.campaignDescription },
    session: {
      current_scene_description: base.currentSceneDescription,
      summary: base.summary,
    },
    party: buildPartyRoster(base, companions, conditions),
    dialogue_history: dialogueRows.map((row) => ({
      speaker_type: row.speakerType,
      speaker_name: row.speakerName ?? row.npcSpeakerName ?? null,
      text: row.text,
    })),
    combat: combatState ? redactCombatState(combatState, requestingCompanionCharacterId) : null,
  };
}

export function redactCombatState(
  state: {
    encounter: { currentRound: number };
    participants: CombatParticipantWithStatus[];
    currentParticipant: CombatParticipantWithStatus | null;
  },
  requestingCompanionCharacterId: string | null,
): RedactedCombat {
  const active = state.participants.filter((participant) => participant.isActive);
  const participants = active.map((participant) => {
    const party = participant.participantType === 'player';
    if (party) {
      const currentHp = participant.status?.currentHp ?? participant.maxHp;
      const maxHp = participant.status?.maxHp ?? participant.maxHp;
      return {
        name: participant.name,
        side: 'party' as const,
        current_hp: currentHp,
        max_hp: maxHp,
      };
    }
    const currentHp = participant.status?.currentHp ?? participant.maxHp;
    const maxHp = participant.status?.maxHp ?? participant.maxHp;
    return { name: participant.name, side: 'enemy' as const, hp_tier: hpTier(currentHp, maxHp) };
  });

  return {
    round: state.encounter.currentRound,
    turn_order: active
      .slice()
      .sort((a, b) => a.turnOrder - b.turnOrder)
      .map((participant) => participant.name),
    current_turn_name: state.currentParticipant?.name ?? null,
    participants,
    your_companion_participant_id:
      active.find(
        (participant) =>
          requestingCompanionCharacterId !== null &&
          participant.characterId !== null &&
          participant.characterId === requestingCompanionCharacterId,
      )?.id ?? null,
  };
}

export class CompanionService {
  static async join(
    sessionId: string,
    characterId: string,
    userId: string,
  ): Promise<SessionCompanion> {
    return db.transaction(async (tx) => {
      const [session] = await tx
        .select({ id: gameSessions.id, mainCharacterId: gameSessions.characterId })
        .from(gameSessions)
        .where(eq(gameSessions.id, sessionId))
        .limit(1)
        .for('update');
      if (!session) throw new NotFoundError('Session', sessionId);

      // Lock only the parent row. PostgreSQL rejects FOR UPDATE on the nullable side of an
      // outer join, so authorization is deliberately a separate, non-locking statement.
      const [ownedSession] = await tx
        .select({ id: gameSessions.id })
        .from(gameSessions)
        .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
        .leftJoin(characters, eq(gameSessions.characterId, characters.id))
        .where(and(eq(gameSessions.id, sessionId), sessionOwnerPredicate(userId)))
        .limit(1);
      if (!ownedSession) throw new NotFoundError('Session', sessionId);

      const [character] = await tx
        .select({ id: characters.id })
        .from(characters)
        .where(and(eq(characters.id, characterId), characterOwnerPredicate(userId)))
        .limit(1);
      if (!character) throw new NotFoundError('Character', characterId);
      if (session.mainCharacterId === characterId) {
        throw new ValidationError('The session main character cannot join as a companion');
      }

      // The parent lock serializes joins for this session. Excluding the candidate preserves
      // idempotent re-joins even when the session is already at the cap with this character.
      const activeRows = await tx
        .select({ id: sessionCompanions.id })
        .from(sessionCompanions)
        .where(
          and(
            eq(sessionCompanions.sessionId, sessionId),
            eq(sessionCompanions.status, 'active'),
            ne(sessionCompanions.characterId, characterId),
          ),
        );
      if (activeRows.length >= MAX_SESSION_COMPANIONS) {
        throw new BusinessLogicError('A session can have at most two active companions', {
          limit: MAX_SESSION_COMPANIONS,
        });
      }

      const [upserted] = await tx
        .insert(sessionCompanions)
        .values({ sessionId, characterId, controller: 'webmcp', status: 'active' })
        .onConflictDoUpdate({
          target: [sessionCompanions.sessionId, sessionCompanions.characterId],
          set: { status: 'active', controller: 'webmcp' },
        })
        .returning();
      if (upserted) return upserted;
      throw new InternalServerError('Failed to join companion');
    });
  }

  static async leave(sessionId: string, companionId: string): Promise<SessionCompanion> {
    const [updated] = await db
      .update(sessionCompanions)
      .set({ status: 'left' })
      .where(and(eq(sessionCompanions.id, companionId), eq(sessionCompanions.sessionId, sessionId)))
      .returning();
    if (!updated) throw new NotFoundError('Companion', companionId);
    return updated;
  }

  static async party(sessionId: string, userId: string): Promise<PartyRosterMember[]> {
    const base = await loadSceneBase(sessionId, userId);
    const companions = await loadActiveCompanionPartyRows(sessionId);
    const ids = [
      ...(base.mainCharacterId ? [base.mainCharacterId] : []),
      ...companions.map((companion) => companion.characterId),
    ];
    return buildPartyRoster(base, companions, await loadConditions(ids));
  }

  static async scene(
    sessionId: string,
    userId: string,
    companionId?: string,
  ): Promise<RedactedScene> {
    const base = await loadSceneBase(sessionId, userId);
    const requestingCompanion = companionId
      ? await loadOwnedCompanion(sessionId, companionId, userId)
      : null;
    const [companions, dialogueRows, activeEncounter] = await Promise.all([
      loadActiveCompanionPartyRows(sessionId),
      db
        .select({
          speakerType: dialogueHistory.speakerType,
          speakerName: characters.name,
          npcSpeakerName: npcs.name,
          text: dialogueHistory.message,
        })
        .from(dialogueHistory)
        .leftJoin(characters, eq(dialogueHistory.speakerId, characters.id))
        .leftJoin(npcs, eq(dialogueHistory.speakerId, npcs.id))
        .where(eq(dialogueHistory.sessionId, sessionId))
        .orderBy(desc(dialogueHistory.timestamp), desc(dialogueHistory.createdAt))
        .limit(20),
      CombatEncounterService.getActiveEncounter(sessionId, userId),
    ]);
    const ids = [
      ...(base.mainCharacterId ? [base.mainCharacterId] : []),
      ...companions.map((companion) => companion.characterId),
    ];
    const combatState = activeEncounter
      ? await CombatEncounterService.getCombatState(activeEncounter.id, userId)
      : null;

    return buildRedactedScene({
      base,
      companions,
      conditions: await loadConditions(ids),
      dialogueRows: dialogueRows.reverse(),
      combatState,
      requestingCompanionCharacterId: requestingCompanion?.character.id ?? null,
    });
  }

  static async say(
    sessionId: string,
    companionId: string,
    text: string,
    userId: string,
  ): Promise<DialogueHistory> {
    const { character } = await loadOwnedCompanion(sessionId, companionId, userId);
    const sanitized = sanitizeCompanionText(text);
    if (sanitized.trim().length === 0) {
      throw new ValidationError('Companion text is empty after sanitization');
    }
    return insertCompanionTranscript(sessionId, character.id, sanitized, {
      source: 'companion',
      speaker_name: character.name,
    });
  }

  static async roll(
    sessionId: string,
    companionId: string,
    request: CompanionRollRequest,
    userId: string,
  ): Promise<CompanionRollResult> {
    const { character, stats } = await loadOwnedCompanion(sessionId, companionId, userId);
    const modifierResult = calculateCompanionRollModifier(
      request.kind,
      request.name,
      {
        level: character.level,
        skillProficiencies: character.skillProficiencies,
        expertiseProficiencies: character.expertiseProficiencies,
        savingThrowProficiencies: character.savingThrowProficiencies,
      } satisfies StoredRollCharacter,
      stats
        ? {
            strength: stats.strength,
            dexterity: stats.dexterity,
            constitution: stats.constitution,
            intelligence: stats.intelligence,
            wisdom: stats.wisdom,
            charisma: stats.charisma,
          }
        : (null satisfies StoredRollStats | null),
    );
    const d20 = rollD20();
    const result = {
      d20,
      modifier: modifierResult.modifier,
      total: d20 + modifierResult.modifier,
      breakdown: modifierResult.breakdown,
    } satisfies CompanionRollResult;
    await insertCompanionTranscript(
      sessionId,
      null,
      buildCompanionRollTranscript(character.name, request, result),
      {
        source: 'companion-roll',
        companion_id: companionId,
        kind: request.kind,
        name: request.name,
        reason: request.reason ?? null,
        d20: result.d20,
        modifier: result.modifier,
        total: result.total,
        breakdown: result.breakdown,
      },
    );
    return result;
  }
}
