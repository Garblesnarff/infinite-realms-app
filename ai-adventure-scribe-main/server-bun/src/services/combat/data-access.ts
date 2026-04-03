/**
 * Combat Data Access Module
 *
 * All database queries for the combat attack system:
 * - Ownership verification
 * - Participant/creature stats fetching
 * - Weapon CRUD operations
 *
 * @module server/services/combat/data-access
 */

/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { and, desc, eq, exists, inArray, or, isNotNull, sql } from 'drizzle-orm';

import { db } from '../../../../db/client';
import {
  combatEncounters,
  combatParticipants,
  combatParticipantStatus,
  gameSessions,
  campaigns,
  weaponAttacks,
  creatureStats,
  characters,
  npcs,
} from '../../../../db/schema/index';
import { NotFoundError } from '../../lib/errors.js';

import type { WeaponAttack, CreatureStats, CombatParticipant } from '../../../../db/schema/index';
import type { CreateWeaponAttackInput } from '../../types/combat.js';

/**
 * Verify a user owns the character (via user_id or owner_id).
 * Throws NOT_FOUND to mask unauthorized access.
 */
export async function verifyCharacterOwnership(characterId: string, userId: string): Promise<void> {
  const character = await db.query.characters.findFirst({
    where: and(
      eq(characters.id, characterId),
      or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
    ),
    columns: { id: true },
  });

  if (!character) {
    throw new NotFoundError('Character', characterId);
  }
}

/**
 * Verify encounter ownership through session campaign/character links.
 * Throws NOT_FOUND for both missing and unauthorized access.
 */
export async function verifyEncounterAccess(encounterId: string, userId: string): Promise<void> {
  const [result] = await db
    .select({ id: combatEncounters.id })
    .from(combatEncounters)
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(
      and(
        eq(combatEncounters.id, encounterId),
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
        ),
      ),
    )
    .limit(1);

  if (!result) {
    throw new NotFoundError('Combat encounter', encounterId);
  }
}

/**
 * Fetch participant with their base creature stats, status, and encounter
 * in a single joined query. This eliminates redundant database round-trips when
 * resolving attacks and applying damage.
 */
export async function getParticipantWithStats(
  participantId: string,
  encounterId: string,
  userId: string,
): Promise<{ participant: any; stats: CreatureStats | null } | null> {
  const [result] = await db
    .select({
      participant: combatParticipants,
      stats: creatureStats,
      status: combatParticipantStatus,
      encounter: combatEncounters,
    })
    .from(combatParticipants)
    .leftJoin(
      creatureStats,
      or(
        and(
          isNotNull(combatParticipants.characterId),
          eq(combatParticipants.characterId, creatureStats.characterId),
        ),
        and(isNotNull(combatParticipants.npcId), eq(combatParticipants.npcId, creatureStats.npcId)),
      ),
    )
    .leftJoin(
      combatParticipantStatus,
      eq(combatParticipants.id, combatParticipantStatus.participantId),
    )
    .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(
      and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId),
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
        ),
      ),
    )
    .limit(1);

  if (!result) return null;

  return {
    participant: {
      ...result.participant,
      status: result.status,
      encounter: result.encounter,
    },
    stats: result.stats as CreatureStats | null,
  };
}

/**
 * Batch fetch multiple participants with their base creature stats, status, and encounter.
 * Eliminates N+1 database round-trips during multi-target resolution (e.g. AoE spells)
 * by combining participant data with their active combat status in a single query.
 */
export async function getParticipantsWithStatsBatch(
  participantIds: string[],
  encounterId: string,
  userId: string,
): Promise<Map<string, { participant: any; stats: CreatureStats | null }>> {
  if (participantIds.length === 0) return new Map();

  const results = await db
    .select({
      participant: combatParticipants,
      stats: creatureStats,
      status: combatParticipantStatus,
      encounter: combatEncounters,
    })
    .from(combatParticipants)
    .leftJoin(
      creatureStats,
      or(
        and(
          isNotNull(combatParticipants.characterId),
          eq(combatParticipants.characterId, creatureStats.characterId),
        ),
        and(isNotNull(combatParticipants.npcId), eq(combatParticipants.npcId, creatureStats.npcId)),
      ),
    )
    .leftJoin(
      combatParticipantStatus,
      eq(combatParticipants.id, combatParticipantStatus.participantId),
    )
    .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(
      and(
        inArray(combatParticipants.id, participantIds),
        eq(combatParticipants.encounterId, encounterId),
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
        ),
      ),
    );

  const resultMap = new Map<string, { participant: any; stats: CreatureStats | null }>();
  results.forEach((r) => {
    resultMap.set(r.participant.id, {
      participant: {
        ...r.participant,
        status: r.status,
        encounter: r.encounter,
      },
      stats: r.stats as CreatureStats | null,
    });
  });
  return resultMap;
}

/**
 * Fetch multiple creature statistics in a single batch query to avoid N+1 problems.
 * Includes ownership verification.
 */
export async function getCreatureStatsBatch(
  creatureIds: string[],
  userId: string,
): Promise<Map<string, CreatureStats>> {
  if (creatureIds.length === 0) return new Map();

  const statsList = await db.query.creatureStats.findMany({
    where: and(
      or(
        inArray(creatureStats.characterId, creatureIds),
        inArray(creatureStats.npcId, creatureIds),
      ),
      or(
        // Access via owned character
        exists(
          db
            .select()
            .from(characters)
            .where(
              and(
                eq(characters.id, creatureStats.characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
              ),
            ),
        ),
        // Access via owned campaign (NPCs)
        exists(
          db
            .select()
            .from(npcs)
            .innerJoin(campaigns, eq(npcs.campaignId, campaigns.id))
            .where(and(eq(npcs.id, creatureStats.npcId), eq(campaigns.userId, userId))),
        ),
      ),
    ),
  });

  const statsMap = new Map<string, CreatureStats>();
  statsList.forEach((stats) => {
    const id = stats.characterId || stats.npcId;
    if (id) statsMap.set(id, stats);
  });
  return statsMap;
}

/**
 * Get creature stats (AC, resistances, etc.) with ownership verification.
 */
export async function getCreatureStats(
  creatureId: string,
  userId: string,
): Promise<CreatureStats | null> {
  const stats = await db.query.creatureStats.findFirst({
    where: and(
      or(eq(creatureStats.characterId, creatureId), eq(creatureStats.npcId, creatureId)),
      or(
        // Access via owned character
        exists(
          db
            .select()
            .from(characters)
            .where(
              and(
                eq(characters.id, creatureStats.characterId),
                or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
              ),
            ),
        ),
        // Access via owned campaign (NPCs)
        exists(
          db
            .select()
            .from(npcs)
            .innerJoin(campaigns, eq(npcs.campaignId, campaigns.id))
            .where(and(eq(npcs.id, creatureStats.npcId), eq(campaigns.userId, userId))),
        ),
      ),
    ),
  });

  return stats || null;
}

/**
 * Get a specific weapon attack with ownership verification.
 */
export async function getWeaponAttack(
  weaponId: string,
  userId: string,
): Promise<WeaponAttack | null> {
  const weapon = await db.query.weaponAttacks.findFirst({
    where: and(
      eq(weaponAttacks.id, weaponId),
      exists(
        db
          .select()
          .from(characters)
          .where(
            and(
              eq(characters.id, weaponAttacks.characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
            ),
          ),
      ),
    ),
  });

  return weapon || null;
}

/**
 * Get all weapon attacks for a character with ownership verification.
 */
export async function getCharacterWeapons(
  characterId: string,
  userId: string,
): Promise<WeaponAttack[]> {
  const weapons = await db.query.weaponAttacks.findMany({
    where: and(
      eq(weaponAttacks.characterId, characterId),
      exists(
        db
          .select()
          .from(characters)
          .where(
            and(
              eq(characters.id, weaponAttacks.characterId),
              or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
            ),
          ),
      ),
    ),
    orderBy: [desc(weaponAttacks.createdAt)],
  });

  return weapons;
}

/**
 * Create a weapon attack for a character with ownership verification.
 */
export async function createWeaponAttack(
  input: CreateWeaponAttackInput,
  userId: string,
): Promise<WeaponAttack> {
  const {
    characterId,
    name,
    attackBonus,
    damageDice,
    damageBonus,
    damageType,
    properties = [],
    description,
  } = input;

  // 🛡️ Sentinel: Incorporate ownership check into the INSERT query using SELECT for defense-in-depth.
  // This ensures that weapons can only be added to characters the user is authorized to access.
  const [weapon] = await db
    .insert(weaponAttacks)
    .select(
      db
        .select({
          characterId: sql`${characterId}`,
          name: sql`${name}`,
          attackBonus: sql`${attackBonus}`,
          damageDice: sql`${damageDice}`,
          damageBonus: sql`${damageBonus}`,
          damageType: sql`${damageType}`,
          properties: sql`${JSON.stringify(properties)}::text[]`,
          description: sql`${description || null}`,
        })
        .from(characters)
        .where(
          and(
            eq(characters.id, characterId),
            or(eq(characters.userId, userId), eq(characters.ownerId, userId))
          )
        )
    )
    .returning();

  if (!weapon) {
    // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
    throw new NotFoundError('Character', characterId);
  }

  return weapon;
}

/**
 * Get a combat participant scoped to a specific encounter with ownership verification.
 * Used to prevent cross-encounter and unauthorized resource access.
 */
export async function getParticipantInEncounter(
  participantId: string,
  encounterId: string,
  userId: string
): Promise<CombatParticipant> {
  // 🛡️ Sentinel: Added userId parameter and joined ownership check.
  // A user can access a participant if they own the character or are the DM (campaign owner).
  const [result] = await db
    .select({
      participant: combatParticipants,
    })
    .from(combatParticipants)
    .innerJoin(combatEncounters, eq(combatParticipants.encounterId, combatEncounters.id))
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(combatParticipants.characterId, characters.id))
    .where(
      and(
        eq(combatParticipants.id, participantId),
        eq(combatParticipants.encounterId, encounterId),
        or(
          eq(campaigns.userId, userId),
          eq(characters.userId, userId),
          eq(characters.ownerId, userId)
        )
      )
    )
    .limit(1);

  if (!result) {
    // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
    throw new NotFoundError('Participant', participantId);
  }

  return result.participant;
}
