import { describe, expect, it } from 'vitest';

import {
  failurePips,
  describeInstantDeath,
  describeStrikeOnDowned,
  describeWake,
} from '../../../../shared/death-save-lines';
import {
  attackAction,
  ENEMY_INSTANT_KILLS_PLAYER,
  ENEMY_SHOOTS_DOWNED_PLAYER,
  ENEMY_STRIKES_DOWNED_PLAYER,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
} from '../../../../shared/test-fixtures/engine-results';
import { formatCombatEngineParts, formatWakeParts } from '../combat-outcome-transcript';
import { dmFacingResolvedAction } from '../dm-resolved-action';

/**
 * #2518: each consequence of a blow on a downed player has its own engine line and card, and the
 * fixtures are the full output of `resolveAttack` (shared/test-fixtures/engine-results.ts).
 */
const ON_YOU = { targetHp: true, targetMaxHp: 7 };
const lineOf = (result: Record<string, unknown>): string => {
  const parts = formatCombatEngineParts(
    attackAction(REEVES, SCHOLAR),
    result,
    FIGHT_ROSTER,
    ON_YOU,
  );
  return parts[parts.length - 1].line;
};

describe('a blow on a downed player has its own engine line (#2518)', () => {
  it('melee within 5 ft: automatic critical hit, two failures, the pips', () => {
    expect(lineOf(ENEMY_STRIKES_DOWNED_PLAYER)).toBe(
      '⚙️ Engine: Captain Sarah Reeves strikes the unconscious The Scholar — automatic critical hit. Two death-save failures. ✕✕○',
    );
  });

  it('a ranged hit: one failure, and no automatic critical hit', () => {
    expect(lineOf(ENEMY_SHOOTS_DOWNED_PLAYER)).toBe(
      '⚙️ Engine: Captain Sarah Reeves hits the unconscious The Scholar from range. One death-save failure. ✕○○',
    );
  });

  it('overflow at or past the maximum: the DEAD line and card, terminal', () => {
    const parts = formatCombatEngineParts(
      attackAction(REEVES, SCHOLAR),
      ENEMY_INSTANT_KILLS_PLAYER,
      FIGHT_ROSTER,
      ON_YOU,
    );
    const death = parts[parts.length - 1];

    expect(death.line).toBe(
      '⚙️ Engine: The Scholar takes massive damage — more than their hit point maximum. The Scholar is DEAD.',
    );
    expect(death.card).toMatchObject({
      kind: 'death_save',
      title: 'The Scholar is dead',
      badge: { word: 'FAILED' },
      deathSave: { failures: 3 },
    });
  });

  it('a third failure on the body says the character is dead in the same line', () => {
    expect(
      describeStrikeOnDowned('The Spider', 'The Scholar', {
        failuresAdded: 2,
        failures: 3,
        automaticCritical: true,
      }),
    ).toBe(
      'The Spider strikes the unconscious The Scholar — automatic critical hit. Two death-save failures. ✕✕✕ The Scholar is DEAD.',
    );
  });

  it('draws the failure pips for a tally of three', () => {
    expect([0, 1, 2, 3].map(failurePips)).toEqual(['○○○', '✕○○', '✕✕○', '✕✕✕']);
  });

  it('carries no DM-facing instruction text', () => {
    for (const text of [
      lineOf(ENEMY_STRIKES_DOWNED_PLAYER),
      lineOf(ENEMY_SHOOTS_DOWNED_PLAYER),
      describeInstantDeath('The Scholar'),
      describeWake('The Scholar', 2),
    ]) {
      expect(text).not.toContain('Narrate');
      expect(text).not.toContain('already happened');
    }
  });
});

describe('the stable hero waking (#2518)', () => {
  it('prints the hours the engine rolled and the 1 HP, from the result that ended the fight', () => {
    // `executeCombatIntent`'s `markCombatEnded` adds `wake` beside `combatEnded`.
    const parts = formatWakeParts({
      combatEnded: true,
      endedReason: 'player_down_stable',
      wake: [{ participantId: SCHOLAR.id, name: 'The Scholar', hours: 3 }],
    });

    expect(parts).toHaveLength(1);
    expect(parts[0].line).toBe(
      '⚙️ Engine: The Scholar is stable and unconscious for 3 hours (1d4). The Scholar wakes with 1 HP.',
    );
    expect(parts[0].card).toMatchObject({ kind: 'death_save', title: 'The Scholar wakes' });
  });

  it('says one hour in the singular, and prints nothing for a result with no wake', () => {
    expect(describeWake('The Scholar', 1)).toContain('for 1 hour (1d4)');
    expect(formatWakeParts({ combatEnded: true })).toEqual([]);
    expect(formatWakeParts(null)).toEqual([]);
  });
});

describe('the DM reads the death save as a sentence (#2518)', () => {
  it('turns a death_save result into an engineFact, not a JSON tally', () => {
    const entry = dmFacingResolvedAction(
      {
        action: { actor_id: SCHOLAR.id, action_type: 'death_save', target_ids: [] },
        outcomes: [],
        engineResult: {
          deathSaves: [
            {
              participantId: SCHOLAR.id,
              roll: 14,
              isSuccess: true,
              isCritical: false,
              successes: 1,
              failures: 0,
              isStabilized: false,
              isDead: false,
              wasRevived: false,
              newCurrentHp: 0,
            },
          ],
        },
      },
      FIGHT_ROSTER,
    );

    expect(entry.engineFact).toBe(
      'The Scholar rolled 14 on their death saving throw — SUCCESS (1 success, 0 failures).',
    );
  });
});
