/**
 * Character Service
 *
 * Handles complex character management operations using Drizzle ORM.
 * Provides type-safe database queries for character creation, updates,
 * and retrieval with proper authorization checks.
 *
 * @module server/services/character-service
 */

/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TRPCError } from '@trpc/server';
import { and, desc, eq, exists, inArray, or, sql } from 'drizzle-orm';

import {
  hasDraconicBloodlineSubclass,
  readArmorClassEquipment,
  syncArmorClassAfterEquipmentChange,
} from './character/character-armor-class.js';
import { CharacterSpellService } from './character/character-spell-service.js';
import { CharacterVitalsService } from './character-vitals-service.js';
import { ClassFeaturesService } from './class-features-service.js';
import { RestHitDiceService } from './rest/rest-hit-dice-service.js';
import { SpellSlotDataAccess } from './spell-slots/spell-slot-data-access.js';
import { db } from '../../../db/client';
import {
  characterPermissions,
  characterEquipment,
  characterSpellSlots,
  characterSubclasses,
  inventoryItems,
  characterStats,
  characters,
} from '../../../db/schema/index';
import { computeArmorClass, type ArmorClassEquipmentItem } from '../../../shared/armor-class';
import { isDraconicBloodline } from '../../../shared/class-feature-choices';
import {
  computeServerArmorClass,
  withStartingPackageEquipped,
} from '../../../shared/creation-armor-class';
import {
  computeLevel1MaxHitPoints,
  hasToughFeat,
  computeMaxHitPointsForLevel,
  findSrdClassForHitPoints,
} from '../../../shared/level-1-hit-points';
import { XP_TO_REACH_LEVEL } from '../../../shared/xp-tables';
import { InternalServerError } from '../lib/errors.js';
import { AVAILABLE_SUBCLASSES, SUBCLASS_CHOICE_LEVELS } from '../types/class-features.js';
import { parseClassLevels, SpellSlotMechanics } from './spell-slots/spell-slot-mechanics.js';

import type { Character, NewCharacter, NewCharacterStats } from '../../../db/schema/index';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Narrow the loose equipment records the route accepts down to the three fields the armour
 * class rule reads. Written here rather than trusting the shape because the body is validated
 * for storage, not for arithmetic.
 */
function toArmorClassItems(equipment: Array<Record<string, unknown>>): ArmorClassEquipmentItem[] {
  return equipment.map((item) => ({
    item_name: typeof item.item_name === 'string' ? item.item_name : null,
    item_type: typeof item.item_type === 'string' ? item.item_type : null,
    equipped: Boolean(item.equipped),
  }));
}

/**
 * #971: background kits list their gold as a bare coin string ('15 gp' in
 * src/data/backgroundOptions) and the wizard's equipment mapping turns every
 * equipment string into an item row — so the background's gold was stored as
 * an inventory item ('15 gp Qty:1') while the purse stayed 0. Gold is not an
 * item: split bare coin amounts out of the equipment list and total them
 * (amount × quantity) so create() lands them in gold_pieces instead.
 */
const BARE_GOLD_ITEM = /^\s*(\d+)\s*gp\s*$/i;

function splitEquipmentGold(equipment?: Array<Record<string, unknown>>): {
  equipment?: Array<Record<string, unknown>>;
  gold: number;
} {
  if (!equipment) return { equipment, gold: 0 };
  let gold = 0;
  const kept: Array<Record<string, unknown>> = [];
  for (const item of equipment) {
    const match = BARE_GOLD_ITEM.exec(String(item.item_name ?? ''));
    const amount = match ? Number(match[1]) : NaN;
    // Only a whole, in-range amount is purse gold: an amount that cannot
    // land in the integer gold_pieces column stays an (inert) item row
    // rather than minting a fractional or overflowing balance (#901's
    // failure class). Quantity collapses the same way — a fractional or
    // negative count contributes its whole, non-negative part.
    if (Number.isSafeInteger(amount) && amount <= 2_147_483_647) {
      const quantity = Number(item.quantity ?? 1);
      gold += amount * (Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 1);
    } else {
      kept.push(item);
    }
  }
  return { equipment: kept, gold };
}

/**
 * Recompute the server-owned derived stats after a stats upsert (#620): the
 * armour class (equipment + Unarmoured Defence) always, and max HP for the
 * character's real level (#829) — with one guard: the stored max HP is only
 * overwritten when it is a value the HP formula itself produced (see the
 * fingerprint check below), never a total the vitals engine stored from
 * rolled level-up gains. A character whose class does not resolve keeps its
 * stored max HP. Current HP keeps the damage already taken: a full-health
 * character stays full, otherwise the stored value is capped at the new max.
 *
 * `previousStats` is the stats row as it was before the upsert (read by the
 * caller before its write), or null when no row existed: the fingerprint is
 * judged at the pre-upsert CON, because the upsert may itself be the CON
 * change being recomputed for, and a row the upsert just inserted holds no
 * vitals-written max HP to protect.
 */
async function recomputeServerDerivedStats(
  characterId: string,
  previousStats?: { constitution: number } | null,
): Promise<void> {
  const [character] = await db
    .select({
      class: characters.class,
      level: characters.level,
      subrace: characters.subrace,
      fightingStyles: characters.fightingStyles,
      classFeatures: characters.classFeatures,
    })
    .from(characters)
    .where(eq(characters.id, characterId))
    .limit(1);
  if (!character) return;
  const [stats] = await db
    .select()
    .from(characterStats)
    .where(eq(characterStats.characterId, characterId))
    .limit(1);
  if (!stats) return;

  // The Draconic pick lives in the wizard's choice string OR the subclass
  // row — a premade body carries it only in the row create recorded, and a
  // classFeatures-only read here reverted a premade's Draconic Resilience
  // AC on its first stats edit (#1019).
  const draconicBloodline =
    isDraconicBloodline(character.classFeatures) ||
    (await hasDraconicBloodlineSubclass(characterId));
  const tough = hasToughFeat(undefined, character.classFeatures);
  const armorClass = computeServerArmorClass(
    character.class,
    {
      dexterity: stats.dexterity,
      constitution: stats.constitution,
      wisdom: stats.wisdom,
    },
    await readArmorClassEquipment(characterId),
    character.fightingStyles,
    draconicBloodline,
  );
  const updates: Partial<NewCharacterStats> = { armorClass, updatedAt: new Date() };

  // A character without a resolvable class keeps its stored HP. (Create
  // throws on a non-empty unresolvable class and falls back to a d8 only for
  // a missing class; the update path must not rewrite HP it cannot derive.)
  //
  // The stored max HP is the fingerprint of whoever wrote it last. It is
  // re-derived at the character's real level only when it equals one of the
  // formula's own outputs at the pre-upsert CON: the level-1 formula (what
  // the pre-#829 create/recompute stored for a character of any level — a
  // level-3 template still carrying level-1 HP is repaired here) or the
  // for-level formula (what the fixed create/recompute stored, so CON
  // changes keep tracking). A stored max matching neither was written by
  // the vitals engine from rolled level-up gains — every level-up adds at
  // least 1 HP, so a rolled total above level 1 can never collide with the
  // level-1 value, and a non-average roll breaks the for-level match — and
  // is kept as stored. Level 1 is unconditional: no level-up has happened
  // yet, so the stored max is the formula's by construction (#620). The
  // upsert never writes the HP columns, so the values read here are the
  // pre-upsert stored ones.
  if (findSrdClassForHitPoints(character.class)) {
    const level = character.level ?? 1;
    const maxHitPoints = computeMaxHitPointsForLevel(
      character.class,
      stats.constitution,
      character.subrace,
      level,
      { draconicBloodline, tough },
    );
    const storedMax = stats.maxHitPoints;
    const judgedCon = previousStats?.constitution ?? stats.constitution;
    const formulaProduced =
      previousStats === null ||
      level === 1 ||
      storedMax ===
        computeLevel1MaxHitPoints(character.class, judgedCon, character.subrace, {
          draconicBloodline,
          tough,
        }) ||
      storedMax ===
        computeMaxHitPointsForLevel(character.class, judgedCon, character.subrace, level, {
          draconicBloodline,
          tough,
        });
    if (formulaProduced) {
      const storedCurrent = stats.currentHitPoints ?? maxHitPoints;
      updates.maxHitPoints = maxHitPoints;
      updates.currentHitPoints =
        storedCurrent === storedMax ? maxHitPoints : Math.min(storedCurrent, maxHitPoints);
    }
  }

  await db.update(characterStats).set(updates).where(eq(characterStats.characterId, characterId));
}

export class CharacterService {
  /**
   * List all characters for a user
   */
  static async listForUser(userId: string, campaignId?: string): Promise<Character[]> {
    // ⚡ Bolt: Eager-load characterStats to avoid N+1 queries when displaying
    // character lists that show HP, ability scores, or modifiers.
    const chars = await db.query.characters.findMany({
      where: and(
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
        campaignId ? eq(characters.campaignId, campaignId) : undefined,
      ),
      orderBy: [desc(characters.createdAt)],
      with: {
        stats: true,
      },
    });

    return chars as Character[];
  }

  /**
   * Get a single character by ID with authorization check
   */
  static async getById(characterId: string, userId: string): Promise<Character | null> {
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
          exists(
            db
              .select({ one: sql`1` })
              .from(characterPermissions)
              .where(
                and(
                  eq(characterPermissions.characterId, characters.id),
                  eq(characterPermissions.userId, userId),
                ),
              ),
          ),
        ),
      ),
      with: {
        stats: true,
        // #264: the sheet shows hit dice remaining/total, so the GET serves
        // the rows the rest system writes.
        hitDice: true,
      },
    });

    if (!character) return null;

    // #264: characters predating the rest system have no hit-dice rows, so the
    // sheet would show no dice and offer no spend prompt on a first short rest
    // (QA-058). Create them lazily on the read, once: the sheet's GET is the
    // path that needs them to exist before a rest is taken. Owner-only — a
    // reader with permission-share access must not write.
    if (
      (character.hitDice?.length ?? 0) === 0 &&
      (character.userId === userId || character.ownerId === userId)
    ) {
      character.hitDice = await RestHitDiceService.ensureHitDice(
        characterId,
        userId,
        character.class,
        character.level ?? 1,
        character.classLevels,
      );
    }

    return character;
  }

  /**
   * Get character with campaign details
   */
  static async getWithCampaign(characterId: string, userId: string): Promise<any> {
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
          exists(
            db
              .select({ one: sql`1` })
              .from(characterPermissions)
              .where(
                and(
                  eq(characterPermissions.characterId, characters.id),
                  eq(characterPermissions.userId, userId),
                ),
              ),
          ),
        ),
      ),
      with: {
        campaign: {
          columns: {
            id: true,
            name: true,
            description: true,
            backgroundImage: true,
          },
        },
        stats: true,
      },
    });

    return character || null;
  }

  /**
   * Create a new character
   */
  static async create(
    userId: string,
    data: Partial<NewCharacter>,
    stats?: Omit<Partial<NewCharacterStats>, 'characterId'>,
    equipment?: Array<Record<string, unknown>>,
    inventory?: Array<Record<string, unknown>>,
    subclassName?: string | null,
  ): Promise<Character> {
    // #1019: a create body can carry the character's subclass — the starter
    // template seeder sends the template's subclass column this way (the
    // wizard stores its pick in the classFeatures JSON instead). Resolve it
    // here, under SubclassService's validity rules, so the subclass takes
    // part in the creation itself: the stats computation below can see it
    // (a Draconic Bloodline sorcerer's HP/AC depend on it) and the feature
    // grant after the transaction reads the row it records. A name the
    // service would reject (unknown for the class, or the character is
    // below the class's subclass choice level) is ignored: the character
    // is created exactly as before, never failed by its subclass.
    const requestedSubclass = subclassName?.trim() || null;
    const resolvedSubclass =
      requestedSubclass &&
      data.class &&
      AVAILABLE_SUBCLASSES[data.class]?.includes(requestedSubclass) &&
      (data.level || 1) >= (SUBCLASS_CHOICE_LEVELS[data.class] ?? 3)
        ? requestedSubclass
        : null;
    if (requestedSubclass && !resolvedSubclass) {
      // The old route path logged a warning when a subclass was not
      // applied; keep the breadcrumb so an unresolvable name is not silent.
      console.warn(
        `CharacterService.create: subclass "${requestedSubclass}" not applied for class "${data.class}" at level ${data.level ?? 1} (unknown name or below the choice level)`,
      );
    }
    // #971: bare coin amounts in the equipment list are purse money, not
    // items — they join gold_pieces below and never become equipment rows.
    const { equipment: nonGoldEquipment, gold: equipmentGold } = splitEquipmentGold(equipment);
    const seededEquipment = nonGoldEquipment?.length
      ? withStartingPackageEquipped(nonGoldEquipment)
      : nonGoldEquipment;
    const created = await db.transaction(async (tx) => {
      const [character] = await tx
        .insert(characters)
        .values({
          ...data,
          userId,
          ownerId: userId,
          name: data.name || 'Unnamed Character',
          level: data.level || 1,
          // #971: the body's declared gold (a Starting Gold roll) plus the
          // gold the equipment list carried as coin strings (backgrounds).
          goldPieces: (data.goldPieces ?? 0) + equipmentGold,
          // #829 finding 4: a character created above level 1 (a premade
          // template) that arrives without XP starts at that level's XP
          // threshold, not at 0 — a level-3 character recorded with 0 XP was
          // demoted by the first progression award that derived its level
          // from the recorded total.
          experiencePoints: data.experiencePoints || XP_TO_REACH_LEVEL[data.level || 1] || 0,
        })
        .returning();

      if (!character) throw new InternalServerError('Failed to create character');

      // #1019: record a body-carried subclass in the same transaction, so
      // everything downstream of the insert (the stats computation below,
      // the post-transaction feature grant) sees the character's subclass
      // from the start — the same end state SubclassService.setSubclass
      // produces for a subclass chosen after creation.
      if (resolvedSubclass && data.class) {
        await tx.insert(characterSubclasses).values({
          characterId: character.id,
          className: data.class,
          subclassName: resolvedSubclass,
          chosenAtLevel: character.level ?? 1,
        });
      }

      // #270: seed the engine's spell-slot table from the single slot source
      // (the 2014 5e tables) at creation, in the same transaction. Non-casters
      // and unrecognized classes correctly get no rows; single-class warlocks
      // seed pact-magic rows at the pact slot level (#397). The client-sent
      // JSONB copy is left exactly as sent; the rows are the engine's source
      // of truth.
      const slotRows = SpellSlotMechanics.seedRowsForCharacter(
        data.class ?? null,
        character.level ?? 1,
        data.classLevels,
      );
      if (slotRows.length > 0) {
        await tx.insert(characterSpellSlots).values(
          slotRows.map((row) => ({
            characterId: character.id,
            spellLevel: row.spellLevel,
            totalSlots: row.totalSlots,
            usedSlots: 0,
          })),
        );
      }

      if (stats) {
        // #620: the server is the only place that computes HP and AC.
        // The client sends inputs (class, ability scores, equipment); any
        // armor_class or hit-point values it sent are ignored. #829: HP is
        // computed for the character's real level — a level-3 template gets
        // level-3 HP, not the level-1 value.
        // #1019: Draconic Bloodline reaches HP/AC from either carrier of
        // the pick — the wizard's classFeatures choice string, or the
        // subclass this create just recorded from the body's subclass.
        const draconicBloodline =
          isDraconicBloodline(data.classFeatures) || resolvedSubclass === 'Draconic Bloodline';
        const tough = hasToughFeat(undefined, data.classFeatures);
        const maxHitPoints = computeMaxHitPointsForLevel(
          data.class,
          stats.constitution,
          data.subrace,
          character.level ?? 1,
          { draconicBloodline, tough },
        );
        await tx.insert(characterStats).values({
          ...stats,
          characterId: character.id,
          armorClass: computeServerArmorClass(
            data.class,
            {
              dexterity: stats.dexterity,
              constitution: stats.constitution,
              wisdom: stats.wisdom,
            },
            seededEquipment ? toArmorClassItems(seededEquipment) : [],
            data.fightingStyles,
            draconicBloodline,
          ),
          maxHitPoints,
          currentHitPoints: maxHitPoints,
        });
      }

      if (seededEquipment?.length) {
        // #388: starting kits list some items twice (the Fighter kit's two
        // handaxes), but character_equipment has UNIQUE(character_id, item_name).
        // Merge duplicates into one row with summed quantity before insert.
        const merged = new Map<string, Record<string, unknown>>();
        for (const item of seededEquipment) {
          const key = String(item.item_name || '');
          const prior = merged.get(key);
          if (prior) {
            merged.set(key, {
              ...prior,
              quantity: Number(prior.quantity || 1) + Number(item.quantity || 1),
            });
          } else {
            merged.set(key, { ...item });
          }
        }
        await tx.insert(characterEquipment).values(
          [...merged.values()].map((item) => ({
            characterId: character.id,
            itemName: String(item.item_name || ''),
            itemType: String(item.item_type || 'equipment'),
            quantity: Number(item.quantity || 1),
            equipped: Boolean(item.equipped),
            isMagic: Boolean(item.is_magic),
            magicBonus: Number(item.magic_bonus || 0),
            magicProperties: item.magic_properties ? String(item.magic_properties) : null,
            requiresAttunement: Boolean(item.requires_attunement),
            isAttuned: Boolean(item.is_attuned),
            attunementRequirements: item.attunement_requirements
              ? String(item.attunement_requirements)
              : null,
            magicItemType: item.magic_item_type ? String(item.magic_item_type) : null,
            magicItemRarity: String(item.magic_item_rarity || 'common'),
            magicEffects: item.magic_effects ? String(item.magic_effects) : null,
          })),
        );
      }

      if (inventory?.length) {
        await tx.insert(inventoryItems).values(
          inventory.map((item) => ({
            characterId: character.id,
            name: String(item.name || ''),
            itemType: String(item.item_type || 'custom'),
            quantity: Number(item.quantity || 1),
            weight: String(item.weight ?? 0),
            description: item.description ? String(item.description) : null,
            properties: item.properties ? String(item.properties) : null,
            isEquipped: Boolean(item.is_equipped),
            isAttuned: Boolean(item.is_attuned),
            requiresAttunement: Boolean(item.requires_attunement),
          })),
        );
      }

      return character;
    });

    // #829: grant the class features for every level the character is
    // created at, so a level-3 template pregen holds its level 1–3 features
    // instead of none. ClassFeaturesService verifies ownership against the
    // committed row on the shared pool, so the grant runs after the
    // transaction, not inside it. Its batch grant skips features the
    // character already holds, so a sequential re-grant adds nothing; that
    // guard is a select-then-insert check with no unique constraint behind
    // it, so it is not race-proof against concurrent grants for the same
    // character.
    //
    // The levels come from parseClassLevels — the same parse the spell-slot
    // seeding above uses — so a multiclass create grants each class its own
    // levels instead of the primary class at the character's total level. A
    // single-class create carries no classLevels and falls back to its class
    // and level, routed through the same parser so class names normalize
    // identically. Per-class levels cap at 20, the SRD maximum.
    //
    // Subclass features: grantFeaturesForLevel adds the features of the
    // subclass recorded in character_subclasses alongside each level's base
    // features. A subclass this create carried in its body was recorded in
    // the transaction above, so its features land here at their own levels;
    // a subclass chosen later is granted by SubclassService.setSubclass. A
    // subclass picked in the creation wizard is stored as a choice string
    // in the classFeatures JSON, not in character_subclasses, so its
    // feature rows are granted by no create path today — a pre-existing
    // gap, separate from this change.
    //
    // If the grant fails, the create fails as a whole: the committed
    // character is deleted again (its rows cascade) and the grant error
    // propagates, so a create either yields a fully granted character or no
    // character — never a silently feature-less one left behind for a retry
    // to duplicate.
    const parsedClassLevels = parseClassLevels(data.classLevels);
    const grantPlan =
      parsedClassLevels.length > 0
        ? parsedClassLevels
        : parseClassLevels([
            { className: created.class ?? data.class, level: created.level ?? data.level ?? 1 },
          ]);
    if (grantPlan.length > 0) {
      try {
        if (resolvedSubclass) {
          // #420 parity with SubclassService.setSubclass: a third-caster
          // subclass (Eldritch Knight, Arcane Trickster) gains its spell
          // slots at once instead of waiting for a level-up re-sync. The
          // sync is an idempotent upsert+prune, so non-caster subclasses
          // are unaffected.
          await SpellSlotDataAccess.syncSpellSlotTotals(created.id, userId);
        }
        for (const entry of grantPlan) {
          const topLevel = Math.min(entry.level, 20);
          for (let featureLevel = 1; featureLevel <= topLevel; featureLevel++) {
            await ClassFeaturesService.grantFeaturesForLevel(
              created.id,
              entry.className,
              featureLevel,
              userId,
            );
          }
        }
      } catch (grantError) {
        try {
          await db.delete(characters).where(eq(characters.id, created.id));
        } catch (deleteError) {
          console.error(
            `Failed to remove character ${created.id} after a failed class-feature grant:`,
            deleteError,
          );
        }
        throw grantError;
      }
    }

    return created;
  }

  static async upsertStats(
    characterId: string,
    userId: string,
    data: Omit<Partial<NewCharacterStats>, 'characterId'>,
  ): Promise<void> {
    // The recompute below judges the stored max HP against the HP formula
    // at the CON in force before this write, so read that CON first (the
    // row may not exist yet — the CTE's insert leg covers that case).
    const [priorStats] = await db
      .select({ constitution: characterStats.constitution })
      .from(characterStats)
      .where(eq(characterStats.characterId, characterId))
      .limit(1);

    // 🛡️ Sentinel: Keep authorization in the same statement as the write.
    // The CTE updates an existing row or inserts a new one only when the caller
    // owns the character. This avoids the old check-then-act gap without using
    // Drizzle's known-broken insert-select builder.
    const result = await db.execute(sql`
      WITH authorized_character AS (
        SELECT c.id
        FROM characters AS c
        WHERE c.id = ${characterId}
          AND (c.user_id = ${userId} OR c.owner_id = ${userId})
      ), updated AS (
        UPDATE character_stats AS cs
        SET strength = COALESCE(${data.strength ?? null}, cs.strength),
            dexterity = COALESCE(${data.dexterity ?? null}, cs.dexterity),
            constitution = COALESCE(${data.constitution ?? null}, cs.constitution),
            intelligence = COALESCE(${data.intelligence ?? null}, cs.intelligence),
            wisdom = COALESCE(${data.wisdom ?? null}, cs.wisdom),
            charisma = COALESCE(${data.charisma ?? null}, cs.charisma),
            temporary_hit_points = COALESCE(${data.temporaryHitPoints ?? null}, cs.temporary_hit_points),
            initiative_bonus = COALESCE(${data.initiativeBonus ?? null}, cs.initiative_bonus),
            speed = COALESCE(${data.speed ?? null}, cs.speed),
            updated_at = now()
        FROM authorized_character AS ac
        WHERE cs.character_id = ac.id
        RETURNING cs.character_id
      ), inserted AS (
        INSERT INTO character_stats (
          character_id,
          strength,
          dexterity,
          constitution,
          intelligence,
          wisdom,
          charisma,
          temporary_hit_points,
          initiative_bonus,
          speed
        )
        SELECT
          ac.id,
          COALESCE(${data.strength ?? null}, 10),
          COALESCE(${data.dexterity ?? null}, 10),
          COALESCE(${data.constitution ?? null}, 10),
          COALESCE(${data.intelligence ?? null}, 10),
          COALESCE(${data.wisdom ?? null}, 10),
          COALESCE(${data.charisma ?? null}, 10),
          COALESCE(${data.temporaryHitPoints ?? null}, 0),
          COALESCE(${data.initiativeBonus ?? null}, 0),
          COALESCE(${data.speed ?? null}, 30)
        FROM authorized_character AS ac
        WHERE NOT EXISTS (SELECT 1 FROM updated)
        RETURNING character_id
      )
      SELECT character_id FROM updated
      UNION ALL
      SELECT character_id FROM inserted
    `);

    if (Array.from(result as Iterable<{ character_id: string }>).length === 0) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'Character not found' });
    }

    // #620: HP and AC are server-computed; the client sends inputs only, so no
    // client value can win. Recompute from the stored row, the character's
    // class and the stored equipment.
    await recomputeServerDerivedStats(characterId, priorStats ?? null);
  }

  /**
   * Apply damage to a character's hit points.
   *
   * @deprecated Use CharacterVitalsService.applyDamage directly. That service is the
   * single writer for character HP, consciousness and death-save state (#1826 C0.5 PR1);
   * this delegate exists only so callers that still reach for CharacterService keep
   * working. The old implementation here wrote hit points and nothing else, which is how
   * a character could reach 0 HP and keep adventuring.
   */
  static async applyDamage(characterId: string, userId: string, amount: number) {
    return CharacterVitalsService.applyDamage(characterId, userId, amount);
  }

  /**
   * Update an existing character
   */
  static async update(
    characterId: string,
    userId: string,
    data: Partial<NewCharacter>,
    equipment?: Array<Record<string, unknown>>,
  ): Promise<Character | null> {
    // 🛡️ Sentinel: Explicitly destructure to prevent Mass Assignment of sensitive fields
    const {
      id: _id,
      userId: _userId,
      ownerId: _ownerId,
      campaignId: _campaignId,
      ...safeUpdates
    } = data as any;

    const saved = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(characters)
        .set({
          ...safeUpdates,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(characters.id, characterId),
            or(
              eq(characters.userId, userId),
              eq(characters.ownerId, userId),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(characterPermissions)
                  .where(
                    and(
                      eq(characterPermissions.characterId, characters.id),
                      eq(characterPermissions.userId, userId),
                      inArray(characterPermissions.permissionLevel, ['editor', 'owner']),
                    ),
                  ),
              ),
            ),
          ),
        )
        .returning();

      if (!updated || !equipment) return updated || null;

      for (const item of equipment) {
        const itemName = String(item.item_name || '').trim();
        const validItemId = typeof item.id === 'string' && UUID_PATTERN.test(item.id);
        let existing = validItemId
          ? await tx
              .select({ id: characterEquipment.id })
              .from(characterEquipment)
              .where(
                and(
                  eq(characterEquipment.id, item.id as string),
                  eq(characterEquipment.characterId, characterId),
                ),
              )
              .limit(1)
          : [];

        if (!existing[0]) {
          existing = await tx
            .select({ id: characterEquipment.id })
            .from(characterEquipment)
            .where(
              and(
                eq(characterEquipment.characterId, characterId),
                eq(characterEquipment.itemName, itemName),
              ),
            )
            .limit(1);
        }

        const textValue = (value: unknown): string | null => {
          if (value === undefined || value === null) return null;
          return Array.isArray(value) ? JSON.stringify(value) : String(value);
        };
        const magicEffects =
          typeof item.magic_effects === 'string'
            ? (() => {
                try {
                  return JSON.parse(item.magic_effects);
                } catch {
                  return item.magic_effects;
                }
              })()
            : (item.magic_effects ?? null);
        const equipmentValues = {
          itemName,
          itemType: item.item_type == null ? 'equipment' : String(item.item_type),
          quantity: item.quantity == null ? 1 : Math.trunc(Number(item.quantity)),
          equipped: Boolean(item.equipped),
          isMagic: Boolean(item.is_magic),
          magicBonus: item.magic_bonus == null ? 0 : Math.trunc(Number(item.magic_bonus)),
          magicProperties: textValue(item.magic_properties),
          requiresAttunement: Boolean(item.requires_attunement),
          isAttuned: Boolean(item.is_attuned),
          attunementRequirements: textValue(item.attunement_requirements),
          magicItemType: textValue(item.magic_item_type),
          magicItemRarity:
            item.magic_item_rarity == null ? 'common' : String(item.magic_item_rarity),
          magicEffects,
          updatedAt: new Date(),
        };

        if (existing[0]) {
          await tx
            .update(characterEquipment)
            .set(equipmentValues)
            .where(
              and(
                eq(characterEquipment.id, existing[0].id),
                eq(characterEquipment.characterId, characterId),
              ),
            );
        } else {
          await tx.insert(characterEquipment).values({
            characterId,
            ...equipmentValues,
          });
        }
      }

      return updated;
    });

    // The sheet PUT writes equipped here and nowhere else (#711). Recompute
    // after commit: sync reads the rows with db, not this transaction.
    // Weapon-only payloads do not own armour, so they leave a hand-set AC alone.
    const unarmored = computeArmorClass([], 0);
    const armorInPayload = equipment?.some((item) => {
      const itemType = String(item.item_type ?? '')
        .trim()
        .toLowerCase();
      if (itemType === 'armor' || itemType === 'shield') return true;
      return (
        computeArmorClass(
          [
            {
              item_name: typeof item.item_name === 'string' ? item.item_name : '',
              item_type: itemType,
              equipped: true,
            },
          ],
          0,
        ) !== unarmored
      );
    });
    if (saved && (armorInPayload || data.fightingStyles !== undefined)) {
      await syncArmorClassAfterEquipmentChange(characterId);
    }
    return saved;
  }

  /**
   * Delete a character
   */
  static async delete(characterId: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(characters)
      .where(
        and(
          eq(characters.id, characterId),
          or(
            eq(characters.userId, userId),
            eq(characters.ownerId, userId),
            exists(
              db
                .select({ one: sql`1` })
                .from(characterPermissions)
                .where(
                  and(
                    eq(characterPermissions.characterId, characters.id),
                    eq(characterPermissions.userId, userId),
                    eq(characterPermissions.permissionLevel, 'owner'),
                  ),
                ),
            ),
          ),
        ),
      )
      .returning({ id: characters.id });

    return result.length > 0;
  }

  /**
   * Update character spells (comma-separated text fields)
   * @deprecated Use CharacterSpellService.updateSpells directly
   */
  static async updateSpells(
    characterId: string,
    userId: string,
    spellData: {
      cantrips?: string[];
      knownSpells?: string[];
      preparedSpells?: string[];
      ritualSpells?: string[];
    },
  ): Promise<Character | null> {
    return CharacterSpellService.updateSpells(characterId, userId, spellData);
  }

  /**
   * Parse comma-separated spell string to array
   * @deprecated Use CharacterSpellService.parseSpells directly
   */
  static parseSpells(spellString: string | null): string[] {
    return CharacterSpellService.parseSpells(spellString);
  }

  /**
   * Export character to JSON
   */
  static async exportCharacter(characterId: string, userId: string): Promise<any> {
    // ⚡ Bolt: Removed redundant checkPermission call.
    // Authorization is verified atomically within the main query's WHERE clause.
    // This reduces database round-trips from 2 to 1.
    const character = await db.query.characters.findFirst({
      where: and(
        eq(characters.id, characterId),
        or(
          eq(characters.userId, userId),
          eq(characters.ownerId, userId),
          exists(
            sql`SELECT 1 FROM character_permissions WHERE character_id = ${characters.id} AND user_id = ${userId}`,
          ),
        ),
      ),
      with: {
        stats: true,
      },
    });

    if (!character) {
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'Character not found',
      });
    }

    // Strip sensitive data
    const exportData = {
      version: '1.0',
      character: {
        name: character.name,
        description: character.description,
        race: character.race,
        class: character.class,
        level: character.level,
        alignment: character.alignment,
        experiencePoints: character.experiencePoints,
        background: character.background,
        imageUrl: character.imageUrl,
        avatarUrl: character.avatarUrl,
        backgroundImage: character.backgroundImage,
        appearance: character.appearance,
        personalityTraits: character.personalityTraits,
        personalityNotes: character.personalityNotes,
        backstoryElements: character.backstoryElements,
        cantrips: character.cantrips,
        knownSpells: character.knownSpells,
        preparedSpells: character.preparedSpells,
        ritualSpells: character.ritualSpells,
        visionTypes: character.visionTypes,
        obscurement: character.obscurement,
        isHidden: character.isHidden,
      },
      stats: character.stats
        ? {
            strength: character.stats.strength,
            dexterity: character.stats.dexterity,
            constitution: character.stats.constitution,
            intelligence: character.stats.intelligence,
            wisdom: character.stats.wisdom,
            charisma: character.stats.charisma,
          }
        : null,
      exportedAt: new Date().toISOString(),
    };

    return exportData;
  }

  /**
   * Import character from JSON
   */
  static async importCharacter(userId: string, characterData: any): Promise<Character> {
    // Validate structure
    if (!characterData.version) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid character data: missing version',
      });
    }

    if (!characterData.character) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid character data: missing character object',
      });
    }

    const charData = characterData.character;

    // Validate required fields
    if (!charData.name) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Invalid character data: missing name',
      });
    }

    // Create character
    const [character] = await db
      .insert(characters)
      .values({
        userId,
        ownerId: userId,
        name: charData.name,
        description: charData.description || null,
        race: charData.race || null,
        class: charData.class || null,
        level: charData.level || 1,
        alignment: charData.alignment || null,
        experiencePoints: charData.experiencePoints || 0,
        background: charData.background || null,
        imageUrl: charData.imageUrl || null,
        avatarUrl: charData.avatarUrl || null,
        backgroundImage: charData.backgroundImage || null,
        appearance: charData.appearance || null,
        personalityTraits: charData.personalityTraits || null,
        personalityNotes: charData.personalityNotes || null,
        backstoryElements: charData.backstoryElements || null,
        cantrips: charData.cantrips || null,
        knownSpells: charData.knownSpells || null,
        preparedSpells: charData.preparedSpells || null,
        ritualSpells: charData.ritualSpells || null,
        visionTypes: charData.visionTypes || null,
        obscurement: charData.obscurement || null,
        isHidden: charData.isHidden || false,
      })
      .returning();

    if (!character) {
      throw new InternalServerError('Failed to import character');
    }

    // Create stats if provided
    if (characterData.stats) {
      await db.insert(characterStats).values({
        characterId: character.id,
        strength: characterData.stats.strength || 10,
        dexterity: characterData.stats.dexterity || 10,
        constitution: characterData.stats.constitution || 10,
        intelligence: characterData.stats.intelligence || 10,
        wisdom: characterData.stats.wisdom || 10,
        charisma: characterData.stats.charisma || 10,
      });
    }

    // #270: same seed as CharacterService.create — an imported caster gets
    // slot rows from the single slot source. The export carries no slot
    // state, so the rows start unspent.
    const importSlotRows = SpellSlotMechanics.seedRowsForCharacter(
      charData.class ?? null,
      character.level ?? 1,
      charData.classLevels,
    );
    if (importSlotRows.length > 0) {
      await db.insert(characterSpellSlots).values(
        importSlotRows.map((row) => ({
          characterId: character.id,
          spellLevel: row.spellLevel,
          totalSlots: row.totalSlots,
          usedSlots: 0,
        })),
      );
    }

    return character;
  }

  /**
   * Save character spells (junction table and character columns) with ownership verification.
   * This is a security-hardened method that replaces direct Supabase calls.
   * @deprecated Use CharacterSpellService.saveCharacterSpells directly
   */
  static async saveCharacterSpells(
    characterId: string,
    userId: string,
    spellIds: string[],
    className: string,
  ): Promise<{ success: boolean; message: string }> {
    return CharacterSpellService.saveCharacterSpells(characterId, userId, spellIds, className);
  }
}
