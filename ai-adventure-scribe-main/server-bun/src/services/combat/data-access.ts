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
import { and, asc, desc, eq, exists, inArray, or, isNotNull, sql } from 'drizzle-orm';

import {
  findCatalogWeapon,
  isUnarmedWeaponClaim,
  UNARMED_STRIKE,
  weaponProfileMatches,
} from './weapon-catalog.js';
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
  characterStats,
  combatParticipantConditions,
  conditionsLibrary,
  characterSpells,
  spells,
  npcs,
  inventoryItems,
  characterEquipment,
} from '../../../../db/schema/index';
import { BusinessLogicError, NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';

import type { WeaponRuleProfile } from './combat-rules.js';
import type { MonsterAttack } from './monster-attack-profile.js';
import type { CatalogWeapon } from './weapon-catalog.js';
import type { WeaponAttack, CreatureStats, CombatParticipant } from '../../../../db/schema/index';
import type { CreateWeaponAttackInput } from '../../types/combat.js';

type EquippedWeaponCandidate = {
  id: string;
  name: string;
  magicBonus: number;
  properties: Record<string, unknown>;
};

function characterCanUseWeapon(
  className: string | null | undefined,
  weapon: CatalogWeapon,
): boolean {
  if (weapon.subcategory?.startsWith('simple')) return true;
  const normalized = className?.toLowerCase() ?? '';
  if (['barbarian', 'fighter', 'paladin', 'ranger'].some((name) => normalized.includes(name)))
    return true;
  const weaponId = weapon.id.toLowerCase();
  if (normalized.includes('bard') || normalized.includes('rogue')) {
    return ['hand-crossbow', 'longsword', 'rapier', 'shortsword'].includes(weaponId);
  }
  if (normalized.includes('druid') && weaponId === 'scimitar') return true;
  return normalized.includes('monk') && weaponId === 'shortsword';
}

function parseInventoryProperties(properties: string | null): Record<string, unknown> {
  if (!properties) return {};
  try {
    return JSON.parse(properties) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function candidateToProfile(
  candidate: EquippedWeaponCandidate,
  className: string | null | undefined,
): WeaponRuleProfile {
  const catalog = findCatalogWeapon(candidate.name);
  const damage = (candidate.properties.damage ?? {}) as Record<string, unknown>;
  const range = (candidate.properties.range ?? {}) as Record<string, unknown>;
  const normalRange = Number(range.normal ?? catalog?.range?.normal ?? 5);
  return {
    id: candidate.id,
    name: candidate.name,
    damageDice: String(damage.dice ?? catalog?.damage?.dice ?? '1'),
    damageType: String(damage.type ?? catalog?.damage?.type ?? 'bludgeoning'),
    normalRange,
    longRange: Number(range.long ?? catalog?.range?.long) || undefined,
    magicBonus: candidate.magicBonus,
    finesse: Boolean(candidate.properties.finesse ?? catalog?.weaponProperties?.finesse),
    ranged: normalRange > 5,
    proficient: catalog ? characterCanUseWeapon(className, catalog) : false,
  };
}

/**
 * Every weapon the participant actually has equipped, in a stable order.
 *
 * The ordering is explicit because callers pick `[0]` when nothing was requested, and an
 * unordered `SELECT` makes that pick whatever the heap happened to hand back — a character
 * with a bow and a sword would get a different "default weapon" depending on which row was
 * last rewritten. `created_at` first means the default is the oldest equipped weapon, and the
 * row id breaks ties so it never moves on its own.
 */
export async function listEquippedWeaponProfiles(participant: any): Promise<WeaponRuleProfile[]> {
  if (participant.characterId) {
    const [inventory, legacy, character] = await Promise.all([
      db
        .select()
        .from(inventoryItems)
        .where(
          and(
            eq(inventoryItems.characterId, participant.characterId),
            eq(inventoryItems.isEquipped, true),
            eq(inventoryItems.itemType, 'weapon'),
          ),
        )
        .orderBy(asc(inventoryItems.createdAt), asc(inventoryItems.id)),
      db
        .select()
        .from(characterEquipment)
        .where(
          and(
            eq(characterEquipment.characterId, participant.characterId),
            eq(characterEquipment.equipped, true),
            eq(characterEquipment.itemType, 'weapon'),
          ),
        )
        .orderBy(asc(characterEquipment.itemName), asc(characterEquipment.id)),
      db.query.characters.findFirst({
        where: eq(characters.id, participant.characterId),
        columns: { class: true },
      }),
    ]);
    const candidates: EquippedWeaponCandidate[] = [
      ...inventory.map((item) => ({
        id: item.id,
        name: item.name,
        magicBonus: Number(parseInventoryProperties(item.properties).magicBonus ?? 0),
        properties: parseInventoryProperties(item.properties),
      })),
      ...legacy.map((item) => ({
        id: item.id,
        name: item.itemName,
        magicBonus: item.magicBonus ?? 0,
        properties: {} as Record<string, unknown>,
      })),
    ];
    return candidates.map((candidate) => candidateToProfile(candidate, character?.class));
  }

  // Scene-grounded attacks are resolved once at seating and stored on the participant. They
  // take precedence over the generic Unarmed Strike fallback even when the seat also points at
  // an NPC row that has no authored actions.
  const storedMonsterWeapons = monsterAttackProfiles(participant);
  if (storedMonsterWeapons.length) return storedMonsterWeapons;

  if (participant.npcId) {
    const npc = await db.query.npcs.findFirst({ where: eq(npcs.id, participant.npcId) });
    const stats = (npc?.stats ?? {}) as Record<string, any>;
    const attacks = (stats.actions ?? stats.attacks ?? []) as Array<Record<string, any>>;
    return attacks.map((attack) => {
      const range = Number(
        attack.range?.normal ?? attack.range ?? (String(attack.type).includes('ranged') ? 80 : 5),
      );
      return {
        id: String(attack.id ?? attack.name),
        name: String(attack.name ?? 'Natural attack'),
        damageDice: String(attack.damageDice ?? attack.damage?.dice ?? '1d4'),
        damageType: String(attack.damageType ?? attack.damage?.type ?? 'bludgeoning'),
        normalRange: range,
        longRange: Number(attack.range?.long) || undefined,
        magicBonus: Number(attack.magicBonus ?? 0),
        finesse: false,
        ranged: range > 5,
        proficient: true,
      } satisfies WeaponRuleProfile;
    });
  }

  // A structured DM combatant: no character sheet, no NPC row, and until now no weapon at
  // all. Its attack profile was resolved and stored when combat started (see
  // `combat-encounter-service.startCombat`), so this reads a decision rather than making one.
  return storedMonsterWeapons;
}

/**
 * The stored monster attack profile, as weapon profiles.
 *
 * `fixedAttackBonus`/`fixedDamageBonus` are what make this work: a stat block's `+10 to hit,
 * 3d8 + 6` is already finished arithmetic, and this participant has no ability scores to
 * rebuild it from. Passing the numbers through verbatim is the difference between a golem
 * that hits like a golem and one that hits at +2 for 1.
 */
function monsterAttackProfiles(participant: any): WeaponRuleProfile[] {
  const profile = participant?.monsterAttack as
    | { source?: string; attacks?: MonsterAttack[] }
    | null
    | undefined;
  const attacks = Array.isArray(profile?.attacks) ? profile.attacks : [];
  return attacks
    .filter((attack) => attack && typeof attack.damageDice === 'string' && attack.damageDice)
    .map(
      (attack) =>
        ({
          id: `monster-attack:${attack.name}`,
          name: attack.name,
          damageDice: attack.damageDice,
          damageType: attack.damageType,
          normalRange: Number(attack.normalRange) || 5,
          ...(attack.longRange ? { longRange: Number(attack.longRange) } : {}),
          // Zero, not the attack bonus: the stat block's numbers arrive through the fixed
          // fields below, and a magic bonus here would be added to them a second time.
          magicBonus: 0,
          finesse: false,
          ranged: Boolean(attack.ranged),
          proficient: true,
          fixedAttackBonus: Number(attack.attackBonus) || 0,
          fixedDamageBonus: Number(attack.damageBonus) || 0,
        }) satisfies WeaponRuleProfile,
    );
}

/** The rung a participant's attack came from, for telemetry. `generic` means it had none. */
export function monsterAttackSource(participant: any): string {
  const profile = participant?.monsterAttack as { source?: string; attacks?: unknown[] } | null;
  if (!profile?.source) return 'generic';
  return Array.isArray(profile.attacks) && profile.attacks.length ? profile.source : 'generic';
}

/** Resolve the participant's equipped weapon from inventory/equipment, never a client stand-in. */
export async function getEquippedWeaponProfile(
  participant: any,
  requestedWeaponId?: string,
): Promise<WeaponRuleProfile> {
  if (requestedWeaponId && isUnarmedWeaponClaim(requestedWeaponId)) {
    return { ...UNARMED_STRIKE };
  }
  const equipped = await listEquippedWeaponProfiles(participant);
  if (requestedWeaponId) {
    const selected = equipped.find((profile) => weaponProfileMatches(profile, requestedWeaponId));
    // A caller that names a weapon is making a claim about the character sheet. Players make
    // that claim from a picker, so a miss is a real error and stays one. Narration-derived
    // claims are grounded before they get here — see `weapon-grounding.ts`.
    if (!selected) {
      throw new BusinessLogicError('Requested weapon is not equipped', { requestedWeaponId });
    }
    return selected;
  }
  if (equipped[0]) return equipped[0];

  // Bottom of the ladder. For a player this is the correct D&D answer -- an unarmed character
  // really does make unarmed strikes -- but for a monster it is the bug this wave exists to
  // close, so it is logged with the identity needed to chase down which creature slipped
  // through with no profile at all.
  if (!participant?.characterId && !participant?.npcId) {
    logger.warn({
      msg: 'COMBAT_MONSTER_ATTACK_FALLBACK',
      participantId: participant?.id ?? null,
      encounterId: participant?.encounterId ?? null,
      combatantName: participant?.name ?? null,
      hasStoredProfile: Boolean(participant?.monsterAttack),
      consequence: `no resolved attack profile; fights with ${UNARMED_STRIKE.name} (${UNARMED_STRIKE.damageDice}) at the participant's own ability modifiers`,
    });
  }
  return { ...UNARMED_STRIKE };
}

export interface AbilityProfile {
  level: number;
  className?: string | null;
  savingThrowProficiencies: string[];
  scores: Record<string, number>;
  saveBonuses: Record<string, number>;
  spellIds: string[];
}

export async function claimEncounterVersion(
  encounterId: string,
  expectedVersion: number,
): Promise<number> {
  const [updated] = await db
    .update(combatEncounters)
    .set({ version: sql`${combatEncounters.version} + 1`, updatedAt: new Date() })
    .where(and(eq(combatEncounters.id, encounterId), eq(combatEncounters.version, expectedVersion)))
    .returning({ version: combatEncounters.version });
  if (!updated) {
    throw new BusinessLogicError('Combat state changed; refresh and retry', { expectedVersion });
  }
  return updated.version;
}

export async function getActiveConditionNames(participantId: string): Promise<string[]> {
  const rows = await db
    .select({ name: conditionsLibrary.name })
    .from(combatParticipantConditions)
    .innerJoin(conditionsLibrary, eq(combatParticipantConditions.conditionId, conditionsLibrary.id))
    .where(
      and(
        eq(combatParticipantConditions.participantId, participantId),
        eq(combatParticipantConditions.isActive, true),
      ),
    );
  return rows.map((row) => row.name.toLowerCase());
}

export async function getParticipantAbilityProfile(participant: any): Promise<AbilityProfile> {
  if (participant.characterId) {
    const [result] = await db
      .select({ character: characters, stats: characterStats })
      .from(characters)
      .leftJoin(characterStats, eq(characters.id, characterStats.characterId))
      .where(eq(characters.id, participant.characterId))
      .limit(1);
    if (!result) throw new NotFoundError('Character', participant.characterId);
    const spellRows = await db
      .select({ id: spells.id, name: spells.name })
      .from(characterSpells)
      .innerJoin(spells, eq(characterSpells.spellId, spells.id))
      .where(eq(characterSpells.characterId, participant.characterId));
    const proficiencies = (result.character.savingThrowProficiencies || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    return {
      level: result.character.level,
      className: result.character.class,
      savingThrowProficiencies: proficiencies,
      scores: {
        str: result.stats?.strength ?? 10,
        dex: result.stats?.dexterity ?? 10,
        con: result.stats?.constitution ?? 10,
        int: result.stats?.intelligence ?? 10,
        wis: result.stats?.wisdom ?? 10,
        cha: result.stats?.charisma ?? 10,
      },
      saveBonuses: {},
      spellIds: [
        ...[
          result.character.cantrips,
          result.character.knownSpells,
          result.character.preparedSpells,
        ]
          .filter(Boolean)
          .flatMap((value) => String(value).split(',')),
        ...spellRows.flatMap((spell) => [spell.id, spell.name]),
      ].map((value) => value.trim().toLowerCase()),
    };
  }

  if (participant.npcId) {
    const npc = await db.query.npcs.findFirst({ where: eq(npcs.id, participant.npcId) });
    if (!npc) throw new NotFoundError('NPC', participant.npcId);
    const stats = (npc.stats || {}) as Record<string, any>;
    return {
      level: Number(stats.level || stats.challengeRating || 1),
      savingThrowProficiencies: [],
      scores: {
        str: Number(stats.strength ?? stats.str ?? 10),
        dex: Number(stats.dexterity ?? stats.dex ?? 10),
        con: Number(stats.constitution ?? stats.con ?? 10),
        int: Number(stats.intelligence ?? stats.int ?? 10),
        wis: Number(stats.wisdom ?? stats.wis ?? 10),
        cha: Number(stats.charisma ?? stats.cha ?? 10),
      },
      saveBonuses: (stats.savingThrows || stats.saveBonuses || {}) as Record<string, number>,
      spellIds: [],
    };
  }

  return { level: 1, savingThrowProficiencies: [], scores: {}, saveBonuses: {}, spellIds: [] };
}

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

  // Character-ownership check split out of the insert. As an insert-select this
  // projected 8 of weapon_attacks' 10 columns and Drizzle rejected it, so a custom
  // weapon could never be added to a character.
  const owned = await db
    .select({ one: sql`1` })
    .from(characters)
    .where(
      and(
        eq(characters.id, characterId),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(1);

  if (owned.length === 0) {
    // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
    throw new NotFoundError('Character', characterId);
  }

  const [weapon] = await db
    .insert(weaponAttacks)
    .values({
      characterId,
      name,
      attackBonus,
      damageDice,
      damageBonus,
      damageType,
      properties,
      description: description || null,
    })
    .returning();

  if (!weapon) {
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
  userId: string,
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
          eq(characters.ownerId, userId),
        ),
      ),
    )
    .limit(1);

  if (!result) {
    // 🛡️ Sentinel: Throw NotFoundError for unauthorized access to mask resource existence.
    throw new NotFoundError('Participant', participantId);
  }

  return result.participant;
}
