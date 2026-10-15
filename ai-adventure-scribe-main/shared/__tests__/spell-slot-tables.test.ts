import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

import {
  FULL_CASTER_SLOTS,
  WARLOCK_PACT_MAGIC,
  halfCasterSlots,
  thirdCasterSlots,
  slotsToMap,
} from '../spell-slot-tables';

/**
 * #617: one spell-slot table shared by client and server (epic #616).
 *
 * Table-driven regression test. The snapshot
 * (spell-slot-tables.snapshot.json) was generated from the OLD table copies
 * before the refactor (gen_snapshot.ts). This test asserts the new shared
 * tables produce identical outputs for every class x level 1-20.
 *
 * Any difference vs the snapshot must be listed and justified in the PR body.
 */

const snapshot: Record<string, unknown> = JSON.parse(
  readFileSync('shared/__tests__/spell-slot-tables.snapshot.json', 'utf8'),
);

const CLASSES = [
  'Wizard',
  'Sorcerer',
  'Cleric',
  'Druid',
  'Bard',
  'Paladin',
  'Ranger',
  'Fighter',
  'Rogue',
  'Warlock',
  'Eldritch Knight',
  'Arcane Trickster',
] as const;

const FULL_CASTERS = new Set(['Wizard', 'Sorcerer', 'Cleric', 'Druid', 'Bard']);
const HALF_CASTERS = new Set(['Paladin', 'Ranger']);
const THIRD_CASTERS = new Set(['Eldritch Knight', 'Arcane Trickster']);

/** Expected server slots for class x level, derived from the shared tables. */
function expectedServerSlots(className: string, level: number): Record<number, number> {
  if (FULL_CASTERS.has(className)) {
    return slotsToMap(FULL_CASTER_SLOTS[level] ?? []) as Record<number, number>;
  }
  if (HALF_CASTERS.has(className)) {
    return slotsToMap(halfCasterSlots(level)) as Record<number, number>;
  }
  if (THIRD_CASTERS.has(className)) {
    return slotsToMap(thirdCasterSlots(level)) as Record<number, number>;
  }
  if (className === 'Warlock') {
    // The old server mechanics returned no regular spell slots for Warlocks;
    // pact slots come from WARLOCK_PACT_MAGIC (tested separately below).
    return {};
  }
  return {};
}

describe('spell-slot-tables (shared single source, #617)', () => {
  it('FULL_CASTER_SLOTS matches the pre-refactor server table', () => {
    expect(FULL_CASTER_SLOTS).toEqual(snapshot['FULL_CASTER_SLOTS']);
  });

  it('WARLOCK_PACT_MAGIC matches the pre-refactor server table', () => {
    for (let level = 1; level <= 20; level++) {
      // The snapshot stores warlockPact under every class key; Wizard@N is arbitrary.
      const snap = snapshot[`Wizard@${level}`] as { warlockPact: unknown };
      expect(WARLOCK_PACT_MAGIC[level]).toEqual(snap.warlockPact);
    }
  });

  it('every class x level 1-20 matches the pre-refactor server outputs', () => {
    for (const className of CLASSES) {
      for (let level = 1; level <= 20; level++) {
        const snap = snapshot[`${className}@${level}`] as { serverSlots: unknown };
        expect(
          expectedServerSlots(className, level),
          `${className} level ${level}`,
        ).toEqual(snap.serverSlots);
      }
    }
  });

  it('half-caster helper matches the pre-refactor client getSpellSlotsByLevel', () => {
    for (const className of ['Paladin', 'Ranger']) {
      for (let level = 1; level <= 20; level++) {
        const snap = snapshot[`${className}@${level}`] as { getSpellSlotsByLevel: number[] };
        // The legacy client table carried 5 spell levels; slice to compare.
        expect(
          [...halfCasterSlots(level).slice(0, 5)],
          `${className} level ${level}`,
        ).toEqual(snap.getSpellSlotsByLevel);
      }
    }
  });

  it('Eldritch Knight and Arcane Trickster cases (#420)', () => {
    // EK 7: third caster, ceil(7/3)=3 -> full table level 3, max 4th-level slots.
    expect(slotsToMap(thirdCasterSlots(7))).toEqual({ 1: 4, 2: 2 });
    // AT 7: same progression.
    const snapEK = snapshot['Eldritch Knight@7'] as { serverSlots: unknown };
    const snapAT = snapshot['Arcane Trickster@7'] as { serverSlots: unknown };
    expect(slotsToMap(thirdCasterSlots(7))).toEqual(snapEK.serverSlots);
    expect(slotsToMap(thirdCasterSlots(7))).toEqual(snapAT.serverSlots);
    // EK 3 (first spellcasting level): ceil(3/3)=1 -> [2].
    expect(slotsToMap(thirdCasterSlots(3))).toEqual({ 1: 2 });
    // EK 2 (no spellcasting yet): no slots.
    expect(slotsToMap(thirdCasterSlots(2))).toEqual({});
  });

  it('Warlock pact slot case', () => {
    // L5 warlock: 2 pact slots at 5th... level 3 (PHB pg. 107).
    expect(WARLOCK_PACT_MAGIC[5]).toEqual({ slots: 2, level: 3 });
    // L11 warlock: 3 pact slots at 5th level.
    expect(WARLOCK_PACT_MAGIC[11]).toEqual({ slots: 3, level: 5 });
    const snap = snapshot['Warlock@11'] as { serverSlots: unknown };
    expect(snap.serverSlots).toEqual({});
  });
});
