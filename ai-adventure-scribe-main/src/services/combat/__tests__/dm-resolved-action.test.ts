import { describe, expect, it } from 'vitest';

import { dmFacingResolvedAction } from '../dm-resolved-action';

const ROSTER = [
  { id: 'scholar-1', name: 'The Scholar' },
  { id: 'reeves-1', name: 'Captain Sarah Reeves' },
  { id: 'imp-1', name: 'Kitchen Imp' },
];

/**
 * A saving-throw spell result exactly as `combat-attack-service` builds it: every field the
 * server always sets, including the attack-shaped ones a save spell still carries (`hit` is
 * `!saved`, `targetAC` 0, the save roll in `totalAttackRoll`). Numbers are run 16 turn 7.
 */
const saveResult = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  hit: true,
  targetAC: 0,
  totalAttackRoll: 6,
  damage: 2,
  damageType: 'acid',
  damageBeforeResistances: 2,
  effectiveResistance: false,
  effectiveVulnerability: false,
  effectiveImmunity: false,
  finalDamage: 2,
  targetNewHp: 9,
  targetIsConscious: true,
  targetIsDead: false,
  targetCondition: 'wounded',
  isCritical: false,
  isNaturalOne: false,
  isNaturalTwenty: false,
  spellName: 'Acid Splash',
  saveAbility: 'dexterity',
  saveRoll: 6,
  saveDC: 14,
  saved: false,
  ...overrides,
});

const CAST = {
  actor_id: 'scholar-1',
  action_type: 'cast_spell',
  target_ids: ['reeves-1'],
  weapon_id: null,
  spell_id: 'acid-splash',
  slot_level: null,
  movement_feet: 0,
};

/** What `resolvedActions.push` builds in `settleExecutedAction`, with `outcomes` from the executor. */
const entryFor = (result: Record<string, unknown>): Record<string, unknown> => ({
  action: CAST,
  outcomes: [
    {
      participantId: 'reeves-1',
      newHp: result.targetNewHp,
      damageType: result.damageType,
      hit: result.hit,
      finalDamage: result.finalDamage,
      isCritical: result.isCritical,
    },
  ],
  engineResult: { results: [result] },
  autoRolled: true,
});

describe('dmFacingResolvedAction: a saving-throw spell (#2391)', () => {
  it('states the failed save and the damage, with no attack wording', () => {
    const entry = dmFacingResolvedAction(entryFor(saveResult()), ROSTER);

    expect(entry.engineFact).toBe(
      'The Scholar cast Acid Splash at Captain Sarah Reeves. Acid Splash is a saving-throw spell: ' +
        'there was no attack roll, so there is no hit or miss. Captain Sarah Reeves rolled a DEX ' +
        'save of 6 against DC 14. Captain Sarah Reeves FAILED the save, so the spell took effect: ' +
        '2 acid damage. Captain Sarah Reeves is now at 9 HP.',
    );
  });

  it('removes every attack-roll field the server sets on a save result', () => {
    const entry = dmFacingResolvedAction(entryFor(saveResult()), ROSTER);
    const wire = JSON.stringify(entry);

    for (const field of ['"hit"', 'totalAttackRoll', 'targetAC', 'isCritical', 'autoRolled']) {
      expect(wire).not.toContain(field);
    }
    expect(entry.outcomes).toEqual([
      {
        participantId: 'reeves-1',
        newHp: 9,
        damageType: 'acid',
        finalDamage: 2,
        saved: false,
      },
    ]);
    expect(entry.engineResult).toMatchObject({
      results: [{ saveRoll: 6, saveDC: 14, saved: false, finalDamage: 2, targetNewHp: 9 }],
    });
  });

  it('states a passed save as no effect, never as a hit', () => {
    const passed = saveResult({
      hit: false,
      saved: true,
      saveRoll: 17,
      finalDamage: 0,
      targetNewHp: 11,
      totalAttackRoll: 17,
    });
    const entry = dmFacingResolvedAction(entryFor(passed), ROSTER);

    expect(entry.engineFact).toContain('rolled a DEX save of 17 against DC 14');
    expect(entry.engineFact).toContain('Captain Sarah Reeves PASSED the save');
    expect(entry.engineFact).toContain(
      "PASSED the save and avoids the spell's effect: no damage. The spell itself worked",
    );
    expect(entry.engineFact).not.toMatch(/fizzle|no effect/i);
    expect(entry.engineFact).not.toContain('FAILED');
    expect(entry.outcomes).toEqual([expect.objectContaining({ saved: true, finalDamage: 0 })]);
  });

  it('states half damage on a passed save', () => {
    const half = saveResult({
      hit: false,
      saved: true,
      saveRoll: 15,
      finalDamage: 6,
      damageType: 'fire',
      spellName: 'Burning Hands',
      saveAbility: 'dexterity',
      targetNewHp: 20,
    });
    const entry = dmFacingResolvedAction(entryFor(half), ROSTER);

    expect(entry.engineFact).toContain("avoids the spell's effect, but still takes 6 fire damage.");
  });

  it('says a killing blow left the target dead', () => {
    const killed = saveResult({ targetNewHp: 0, targetIsDead: true, targetIsConscious: false });
    const entry = dmFacingResolvedAction(entryFor(killed), ROSTER);

    expect(entry.engineFact).toContain('is now at 0 HP and is DEAD.');
  });

  it('words each target of an area spell, and marks each save', () => {
    const second = saveResult({
      saved: true,
      hit: false,
      saveRoll: 16,
      finalDamage: 3,
      damageType: 'fire',
      spellName: 'Burning Hands',
      targetNewHp: 4,
    });
    const first = saveResult({
      spellName: 'Burning Hands',
      damageType: 'fire',
      finalDamage: 12,
      targetNewHp: 28,
    });
    const entry = dmFacingResolvedAction(
      {
        ...entryFor(first),
        action: { ...CAST, target_ids: ['reeves-1', 'imp-1'] },
        outcomes: [
          { participantId: 'reeves-1', hit: true, finalDamage: 12 },
          { participantId: 'imp-1', hit: false, finalDamage: 3 },
        ],
        engineResult: { results: [first, second] },
      },
      ROSTER,
    );

    expect(entry.engineFact).toContain('Captain Sarah Reeves FAILED the save');
    expect(entry.engineFact).toContain('Kitchen Imp PASSED the save');
    expect((entry.outcomes as Array<{ saved: boolean }>).map(({ saved }) => saved)).toEqual([
      false,
      true,
    ]);
  });
});

describe('dmFacingResolvedAction: everything else is left as the engine sent it', () => {
  const attackResult = {
    resolvedAs: 'attack',
    d20: 2,
    attackBonus: 6,
    totalAttackRoll: 8,
    targetAC: 14,
    baseAc: 12,
    coverBonus: 2,
    cover: 1,
    hit: false,
    finalDamage: 0,
    isCritical: false,
    isNaturalOne: false,
    isNaturalTwenty: false,
    spellName: 'Chill Touch',
  };

  it('adds the engine line as a fact for a spell attack and leaves its fields alone', () => {
    const entry = {
      action: CAST,
      outcomes: [{ participantId: 'reeves-1', hit: false }],
      engineResult: attackResult,
    };

    const facing = dmFacingResolvedAction(entry, ROSTER);

    expect(facing.engineResult).toBe(entry.engineResult);
    expect(facing.outcomes).toBe(entry.outcomes);
    expect(facing.engineFact).toContain('spell attack 2 + 6 = 8');
    expect(facing.engineFact).toContain('MISS. No damage.');
    expect(facing.engineFact).not.toContain('⚙️');
  });

  it('names each target of a multi-target spell attack, not the first for all', () => {
    const missile = (finalDamage: number, targetNewHp: number): Record<string, unknown> => ({
      autoHit: true,
      spellName: 'Magic Missile',
      finalDamage,
      damageType: 'force',
      targetNewHp,
    });
    const entry = {
      action: { ...CAST, target_ids: ['reeves-1', 'imp-1'], spell_id: 'magic-missile' },
      outcomes: [],
      engineResult: { results: [missile(4, 5), missile(7, 1)] },
    };

    const facing = dmFacingResolvedAction(entry, ROSTER);

    expect(facing.engineFact).toContain(
      'cast Magic Missile at Captain Sarah Reeves — AUTO-HIT. 4 force damage. Captain Sarah Reeves is now at 5 HP.',
    );
    expect(facing.engineFact).toContain(
      'cast Magic Missile at Kitchen Imp — AUTO-HIT. 7 force damage. Kitchen Imp is now at 1 HP.',
    );
  });

  it('leaves an ordinary attack entry exactly as it was, plus the fact line', () => {
    const attack = {
      action: {
        ...CAST,
        actor_id: 'reeves-1',
        target_ids: ['scholar-1'],
        action_type: 'attack',
        weapon_id: 'longsword',
        spell_id: null,
      },
      outcomes: [{ participantId: 'scholar-1', hit: true, finalDamage: 3, newHp: 4 }],
      engineResult: {
        d20: 14,
        attackBonus: 0,
        totalAttackRoll: 14,
        targetAC: 11,
        hit: true,
        finalDamage: 3,
        damageType: 'slashing',
        isCritical: false,
        targetNewHp: 4,
        targetCondition: 'wounded',
        autoRolled: true,
      },
      actorIsPlayer: false,
    };

    const facing = dmFacingResolvedAction(attack, ROSTER);

    const { engineFact, ...unchanged } = facing;
    expect(unchanged).toEqual(attack);
    expect(engineFact).toContain(
      'Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11 against The Scholar — HIT (auto-rolled). 3 slashing damage. The Scholar is wounded.',
    );
  });

  it('words a failed save with no damage figure without inventing one', () => {
    const conditionOnly = saveResult({ hit: true, finalDamage: undefined, damageType: undefined });
    const entry = dmFacingResolvedAction(entryFor(conditionOnly), ROSTER);

    expect(entry.engineFact).toContain('FAILED the save, so the spell took effect.');
    expect(entry.engineFact).not.toMatch(/\d+ (\w+ )?damage/);
  });

  it('does not call a save with no recorded verdict a failed one', () => {
    const entry = dmFacingResolvedAction(entryFor(saveResult({ saved: undefined })), ROSTER);

    expect(entry.engineFact).not.toContain('FAILED');
    expect(entry.engineFact).not.toContain('saving-throw spell');
  });

  it('returns a refusal record, which has no engine result, untouched', () => {
    const refusal = { resolved: false, actor: 'The Scholar', engineRefusal: 'not your turn' };

    expect(dmFacingResolvedAction(refusal, ROSTER)).toBe(refusal);
  });

  it('returns a bare movement, which has no line to restate, untouched', () => {
    const movement = {
      action: { ...CAST, action_type: 'move' },
      outcomes: [],
      engineResult: { resolvedAs: 'movement_only', movedFeet: 30 },
    };

    expect(dmFacingResolvedAction(movement, ROSTER)).toBe(movement);
  });
});
