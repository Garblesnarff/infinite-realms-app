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
  readArmorClassEquipment,
  syncArmorClassAfterEquipmentChange,
} from './character/character-armor-class.js';
import { CharacterSpellService } from './character/character-spell-service.js';
import { CharacterVitalsService } from './character-vitals-service.js';
import { RestHitDiceService } from './rest/rest-hit-dice-service.js';
import { db } from '../../../db/client';
import {
  characterPermissions,
  characterEquipment,
  characterSpellSlots,
  inventoryItems,
  characterStats,
  characters,
} from '../../../db/schema/index';
import {
  computeArmorClass,
  describeArmorClass,
  isSrdArmorOrShieldName,
  type ArmorClassEquipmentItem,
} from '../../../shared/armor-class';
import { isCatalogWeaponName } from '../../../shared/equipment-weapon-resolver';
import {
  computeLevel1MaxHitPoints,
  findSrdClassForHitPoints,
} from '../../../shared/level-1-hit-points';
import { InternalServerError } from '../lib/errors.js';
import { SpellSlotMechanics } from './spell-slots/spell-slot-mechanics.js';
import { abilityModifier } from '../../../shared/ability-modifier';

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

function equipmentItemName(item: Record<string, unknown>): string {
  return typeof item.item_name === 'string' ? item.item_name : '';
}

/**
 * Level-1 HP and armour class live in shared/ now (#620): the server and the
 * creation preview call the same helpers, so the two cannot drift apart.
 */

/**
 * Armour class, server-side (#620). Unarmoured Defence (Barbarian +CON, Monk
 * +WIS) applies only when no armour is worn; a Monk also loses it while
 * using a shield. Everything else defers to the shared equipment rule.
 */
function computeServerArmorClass(
  className: string | null | undefined,
  scores: {
    dexterity?: number | null;
    constitution?: number | null;
    wisdom?: number | null;
  },
  equipment: ArmorClassEquipmentItem[],
  fightingStyles?: unknown,
): number {
  const breakdown = describeArmorClass(equipment, abilityModifier(scores.dexterity ?? 10), {
    fightingStyles,
  });
  const normalized = (className ?? '').trim().toLowerCase();
  const hasUnarmoredDefense =
    !breakdown.armor && (normalized === 'barbarian' || normalized === 'monk');
  if (!hasUnarmoredDefense) return breakdown.armorClass;
  // A Monk's Unarmoured Defence stops working with a shield; the shield's +2
  // from the equipment rule still applies.
  if (normalized === 'monk' && breakdown.shieldBonus > 0) return breakdown.armorClass;
  return (
    breakdown.armorClass +
    abilityModifier((normalized === 'barbarian' ? scores.constitution : scores.wisdom) ?? 10)
  );
}

/**
 * Starting packages arrive with equipped: false (#710). Wear SRD armour, a shield, and the
 * first catalog weapon. Leave the rest carried. An item the caller already marked equipped
 * stays that way, and a second weapon is not worn when one already is. Create only — an
 * update that unequips must stick.
 */
function withStartingPackageEquipped(
  equipment: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  let woreWeapon = equipment.some(
    (item) => item.equipped === true && isCatalogWeaponName(equipmentItemName(item)),
  );
  return equipment.map((item) => {
    if (item.equipped === true) return item;
    const name = equipmentItemName(item);
    if (isSrdArmorOrShieldName(name)) return { ...item, equipped: true };
    if (!woreWeapon && isCatalogWeaponName(name)) {
      woreWeapon = true;
      return { ...item, equipped: true };
    }
    return item;
  });
}

/**
 * Recompute the server-owned derived stats after a stats upsert (#620): the
 * armour class (equipment + Unarmoured Defence) always, and max HP for
 * level-1 characters. Higher-level characters keep their stored max HP — it
 * belongs to the vitals engine once level-ups have happened. Current HP keeps
 * the damage already taken: a full-health character stays full, otherwise the
 * stored value is capped at the new max.
 */
async function recomputeServerDerivedStats(characterId: string): Promise<void> {
  const [character] = await db
    .select({
      class: characters.class,
      level: characters.level,
      subrace: characters.subrace,
      fightingStyles: characters.fightingStyles,
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

  const armorClass = computeServerArmorClass(
    character.class,
    {
      dexterity: stats.dexterity,
      constitution: stats.constitution,
      wisdom: stats.wisdom,
    },
    await readArmorClassEquipment(characterId),
    character.fightingStyles,
  );
  const updates: Partial<NewCharacterStats> = { armorClass, updatedAt: new Date() };

  // A character without a resolvable class keeps its stored HP; only a
  // level-1 character of a known class gets the formula re-derived. (Create
  // throws on a non-empty unresolvable class and falls back to a d8 only for
  // a missing class; the update path must not rewrite HP it cannot derive.)
  if ((character.level ?? 1) === 1 && findSrdClassForHitPoints(character.class)) {
    const maxHitPoints = computeLevel1MaxHitPoints(
      character.class,
      stats.constitution,
      character.subrace,
    );
    const storedMax = stats.maxHitPoints ?? maxHitPoints;
    const storedCurrent = stats.currentHitPoints ?? maxHitPoints;
    updates.maxHitPoints = maxHitPoints;
    updates.currentHitPoints =
      storedCurrent === storedMax ? maxHitPoints : Math.min(storedCurrent, maxHitPoints);
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
  ): Promise<Character> {
    const seededEquipment = equipment?.length ? withStartingPackageEquipped(equipment) : equipment;
    return db.transaction(async (tx) => {
      const [character] = await tx
        .insert(characters)
        .values({
          ...data,
          userId,
          ownerId: userId,
          name: data.name || 'Unnamed Character',
          level: data.level || 1,
          experiencePoints: data.experiencePoints || 0,
        })
        .returning();

      if (!character) throw new InternalServerError('Failed to create character');

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
        // #620: the server is the only place that computes level-1 HP and AC.
        // The client sends inputs (class, ability scores, equipment); any
        // armor_class or hit-point values it sent are ignored.
        const maxHitPoints = computeLevel1MaxHitPoints(
          data.class,
          stats.constitution,
          data.subrace,
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
  }

  static async upsertStats(
    characterId: string,
    userId: string,
    data: Omit<Partial<NewCharacterStats>, 'characterId'>,
  ): Promise<void> {
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
    await recomputeServerDerivedStats(characterId);
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
