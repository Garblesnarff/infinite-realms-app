/**
 * Server-side concentration tracking (2014 5e, #621 Round 4).
 *
 * While a caster concentrates on a spell, every hit forces a Constitution
 * saving throw: DC 10 or half the damage taken, whichever is higher. A failed
 * save ends concentration. This module owns the table, the DC math, and the
 * save; POST /v1/characters/:id/damage calls `checkConcentrationOnDamage`
 * after every hit (combat and out-of-combat) via `applyNonAttackDamage`.
 *
 * @module server/services/combat/concentration-service
 */
import { and, desc, eq } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { characterConcentration, characterStats } from '../../../../db/schema/index';
import { abilityModifier } from '../../../../shared/ability-modifier.js';
import { rollD20 } from '../../lib/dice.js';

export interface ConcentrationState {
  id: string;
  characterId: string;
  spellName: string;
  spellId: string | null;
  startedAt: Date | null;
}

/**
 * The 2014 concentration DC: 10 or half the damage taken, whichever is higher.
 * Pure, so the exact table the strategist asked for is pinned by unit test.
 */
export function concentrationSaveDc(damageTaken: number): number {
  return Math.max(10, Math.floor(Math.max(0, Math.trunc(damageTaken)) / 2));
}

/**
 * Start concentrating on a spell. 2014: a caster holds one concentration at a
 * time, so this replaces any existing row for the character.
 */
export async function startConcentration(
  characterId: string,
  spell: { name: string; id?: string },
): Promise<void> {
  await db
    .insert(characterConcentration)
    .values({
      characterId,
      spellName: spell.name,
      spellId: spell.id ?? null,
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: characterConcentration.characterId,
      set: {
        spellName: spell.name,
        spellId: spell.id ?? null,
        startedAt: new Date(),
        updatedAt: new Date(),
      },
    });
}

/** The spell the character is concentrating on, or null when they are not. */
export async function getConcentration(characterId: string): Promise<ConcentrationState | null> {
  const [row] = await db
    .select({
      id: characterConcentration.id,
      characterId: characterConcentration.characterId,
      spellName: characterConcentration.spellName,
      spellId: characterConcentration.spellId,
      startedAt: characterConcentration.startedAt,
    })
    .from(characterConcentration)
    .where(eq(characterConcentration.characterId, characterId))
    .limit(1);
  return row ?? null;
}

/**
 * Drop concentration. The delete is scoped to the exact row that was read, so
 * a new spell started between the check and the drop is never removed by a
 * stale failed save. Returns the spell name that was dropped, or null when
 * nothing matched.
 */
export async function dropConcentration(
  characterId: string,
  expectedId?: string,
): Promise<string | null> {
  const current = await getConcentration(characterId);
  if (!current) return null;
  if (expectedId && current.id !== expectedId) return null;
  await db
    .delete(characterConcentration)
    .where(
      expectedId
        ? and(
            eq(characterConcentration.characterId, characterId),
            eq(characterConcentration.id, expectedId),
          )
        : eq(characterConcentration.characterId, characterId),
    );
  return current.spellName;
}

async function constitutionModifier(characterId: string): Promise<number> {
  // character_stats has no unique constraint on character_id; order by
  // creation so the read is deterministic if duplicates ever exist.
  const [row] = await db
    .select({ constitution: characterStats.constitution })
    .from(characterStats)
    .where(eq(characterStats.characterId, characterId))
    .orderBy(desc(characterStats.createdAt))
    .limit(1);
  // One owner for the modifier rule (#616): shared/ability-modifier.ts.
  return abilityModifier(row?.constitution ?? 10);
}

/** Player-facing line for a broken concentration, in the engine-lines style. */
export function describeConcentrationBroken(name: string, spellName: string): string {
  return `${name} loses concentration on ${spellName}.`;
}

/** Player-facing line for a maintained concentration, so the DM can narrate the save. */
export function describeConcentrationMaintained(
  name: string,
  spellName: string,
  total: number,
  dc: number,
): string {
  return `${name} maintains concentration on ${spellName} (CON save ${total} vs DC ${dc}).`;
}

export interface ConcentrationCheckResult {
  /** Whether the character was concentrating when the damage landed. */
  hadConcentration: boolean;
  /** Whether a CON save was rolled (false when no concentration, no damage, or incapacitated). */
  saveTriggered: boolean;
  dc?: number;
  roll?: number;
  /** d20 + CON modifier. */
  total?: number;
  success?: boolean;
  dropped?: boolean;
  droppedSpell?: string;
  /** The spell being concentrated on, when there was one. */
  spellName?: string;
  /** True when concentration ended because the character was incapacitated, not from a failed save. */
  incapacitated?: boolean;
}

/**
 * After damage: when the character is concentrating and actually took damage,
 * roll a CON save against `concentrationSaveDc(damageTaken)`. A failed save
 * drops concentration. An incapacitated character (dying or dead) loses
 * concentration outright, no save — 2014 PHB. `rollD20Fn` exists so tests can
 * pin the die; production passes nothing and gets the server-owned `rollD20`.
 */
export async function checkConcentrationOnDamage(
  characterId: string,
  damageTaken: number,
  opts: { rollD20Fn?: () => number; incapacitated?: boolean } = {},
): Promise<ConcentrationCheckResult> {
  const current = await getConcentration(characterId);
  if (!current) return { hadConcentration: false, saveTriggered: false };
  if (opts.incapacitated) {
    const droppedSpell = (await dropConcentration(characterId, current.id)) ?? current.spellName;
    return {
      hadConcentration: true,
      saveTriggered: false,
      dropped: true,
      droppedSpell,
      spellName: current.spellName,
      incapacitated: true,
    };
  }
  const damage = Math.max(0, Math.trunc(damageTaken));
  // No damage taken, no save: a hit fully absorbed before it touches the
  // character does not threaten concentration.
  if (damage <= 0)
    return { hadConcentration: true, saveTriggered: false, spellName: current.spellName };

  const dc = concentrationSaveDc(damage);
  const roll = (opts.rollD20Fn ?? rollD20)();
  const total = roll + (await constitutionModifier(characterId));
  const success = total >= dc;
  let droppedSpell: string | undefined;
  if (!success) {
    droppedSpell = (await dropConcentration(characterId, current.id)) ?? current.spellName;
  }
  return {
    hadConcentration: true,
    saveTriggered: true,
    dc,
    roll,
    total,
    success,
    dropped: !success,
    droppedSpell,
    spellName: current.spellName,
  };
}
