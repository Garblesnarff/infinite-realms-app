/**
 * The self-cast gate's evidence matrix (#902, self-review round).
 *
 * `isSelfCastSpell` admits a spell to the engine's self-cast acknowledgment by rule —
 * range Self, concentration, and no damage / attack roll / saving throw / area for the
 * engine to resolve against another creature. The rule is general, but its OUTPUT on
 * today's catalog is a specific set of spells, and that set is pinned here spell by
 * spell: if a catalog edit adds a Self-range spell, or a spell's fields change, this
 * test fails and a human makes the admit/refuse call consciously instead of the gate
 * silently growing — the same discipline PLAYER_COMBAT_SPELL_IDS documents for the
 * damaging surface.
 *
 * Admitted: concentration senses and utility the DM narrates (Detect Magic and its kin),
 * plus concentration auras/defenses whose effects no engine state tracks today (Blur,
 * Spirit Guardians) — for all of them the cast's mechanical content is the slot, the
 * action, and the concentration row that tracks the spell's life.
 * Refused: every non-concentration Self spell, whose effect is instant or lives in
 * state the acknowledgment does not write (False Life's and Armor of Agathys' temporary
 * hit points, Misty Step's movement, Shield's reaction) — those keep the honest refusal
 * rather than spend a slot on an effect nothing records.
 */
import { describe, expect, it } from 'vitest';

import { allSpells, assessPlayerCombatSpell, isSelfCastSpell } from '../spellData.js';

import type { Spell } from '../spellData.js';

const ADMITTED = [
  'alter-self',
  'antilife-shell',
  'antimagic-field',
  'blur',
  'control-weather',
  'detect-evil-and-good',
  'detect-magic',
  'detect-poison-and-disease',
  'detect-thoughts',
  'expeditious-retreat',
  'find-the-path',
  'friends',
  'globe-of-invulnerability',
  'holy-aura',
  'locate-creature',
  'locate-object',
  'mislead',
  'pass-without-trace',
  'shapechange',
  'spirit-guardians',
  'tree-stride',
];

const REFUSED = [
  'armor-of-agathys',
  'augury',
  'blade-ward',
  'blink',
  'commune',
  'commune-with-nature',
  'comprehend-languages',
  'contingency',
  'disguise-self',
  'divination',
  'etherealness',
  'false-life',
  'glibness',
  'legend-lore',
  'locate-animals-or-plants',
  'mirror-image',
  'misty-step',
  'see-invisibility',
  'shield',
  'speak-with-animals',
  'speak-with-plants',
  'time-stop',
  'tiny-hut',
  'wish',
];

/** The candidate pool the gate decides on: Self range and nothing to resolve against another creature. */
function candidates(): Spell[] {
  return allSpells.filter(
    (spell) =>
      /^self\b/i.test(spell.range.trim()) &&
      !spell.damage &&
      (!spell.damageByLevel || Object.keys(spell.damageByLevel).length === 0) &&
      !spell.attackType &&
      !spell.saveAbility &&
      !spell.areaOfEffect,
  );
}

describe('self-cast gate evidence matrix (#902)', () => {
  it('admits exactly the pinned concentration set, no more and no less', () => {
    const admitted = candidates()
      .filter((spell) => isSelfCastSpell(spell))
      .map((spell) => spell.id)
      .sort();
    expect(admitted).toEqual([...ADMITTED].sort());
  });

  it('refuses exactly the pinned non-concentration set', () => {
    const refused = candidates()
      .filter((spell) => !isSelfCastSpell(spell))
      .map((spell) => spell.id)
      .sort();
    expect(refused).toEqual([...REFUSED].sort());
  });

  it('every admitted spell is castable through the assessor, every refused one is not', () => {
    for (const spell of candidates()) {
      const verdict = assessPlayerCombatSpell(
        spell.id,
        spell.name,
        spell.level >= 1 ? spell.level : undefined,
      );
      expect({ id: spell.id, castable: verdict.castable }).toEqual({
        id: spell.id,
        castable: ADMITTED.includes(spell.id),
      });
    }
  });

  it('the reported case and the two named exclusions sit on their decided sides', () => {
    expect(isSelfCastSpell(allSpells.find((spell) => spell.id === 'detect-magic'))).toBe(true);
    expect(isSelfCastSpell(allSpells.find((spell) => spell.id === 'false-life'))).toBe(false);
    expect(isSelfCastSpell(allSpells.find((spell) => spell.id === 'armor-of-agathys'))).toBe(
      false,
    );
  });
});
