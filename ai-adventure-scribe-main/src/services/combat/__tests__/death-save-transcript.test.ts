import { describe, expect, it } from 'vitest';

import {
  attackAction,
  DEATH_SAVE_FAILED,
  DEATH_SAVE_PASSED,
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  PLAYER_SPELL_ATTACK_HITS,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../../shared/test-fixtures/engine-results';
import {
  formatCombatEngineParts,
  formatDeathSaveParts,
  type EngineTranscriptPart,
} from '../combat-outcome-transcript';

/**
 * Every player-visible string the transcript payload carries for the formatted parts:
 * the engine lines and the card fields the transcript renders. The issue requires the
 * no-instruction assertion to run over this whole payload, not just the lines.
 */
const payloadStrings = (parts: EngineTranscriptPart[]): string[] => [
  ...parts.map((part) => part.line),
  ...parts.flatMap((part) => [
    part.card.title,
    part.card.detail ?? '',
    part.card.effect ?? '',
    part.card.status ?? '',
  ]),
];

/** No DM-facing instruction text anywhere the player can read (#2457). */
const assertNoDmInstructions = (strings: readonly string[]): void => {
  for (const text of strings) {
    expect(text).not.toContain('Narrate');
    expect(text).not.toContain('already happened');
  }
};

describe('damage at 0 HP in the player transcript (#2457)', () => {
  // Producer: CombatAttackService.resolveAttack spreads the damage layer's failure fields
  // onto the AttackResult (server-bun/src/services/combat/combat-attack-service.ts).
  const CRIT_AT_ZERO_HP = {
    ...ENEMY_HITS_PLAYER,
    finalDamage: 6,
    targetNewHp: 0,
    targetIsConscious: false,
    targetIsDead: false,
    isCritical: true,
    deathSaveFailuresAdded: 2,
    deathSavesFailures: 2,
  };
  const ON_YOU = { targetHp: true, targetMaxHp: 7 };

  it('gives a struck-at-0-HP attack its own engine line and death-save card', () => {
    const parts = formatCombatEngineParts(
      attackAction(REEVES, SCHOLAR),
      CRIT_AT_ZERO_HP,
      FIGHT_ROSTER,
      ON_YOU,
    );
    const extra = parts[parts.length - 1];
    // The Engine: prefix marks this as engine fact, not DM fiction (#2457).
    expect(extra.line.startsWith('⚙️ Engine:')).toBe(true);
    expect(extra.line).toContain('takes damage at 0 HP');
    expect(extra.line).toContain('2 automatic death-save failures');
    expect(extra.line).toContain('2 of 3 failures');
    expect(extra.card.kind).toBe('death_save');
    expect(extra.card.badge).toMatchObject({ word: 'FAILED' });
    expect(extra.card.deathSave).toMatchObject({ failures: 2 });
  });

  it('gives a struck-at-0-HP spell its own engine line and death-save card', () => {
    // Producer: CombatAttackService.resolveSpellAttack, one AttackResult per target.
    const parts = formatCombatEngineParts(
      spellAction(REEVES, SCHOLAR),
      {
        results: [
          {
            ...PLAYER_SPELL_ATTACK_HITS,
            targetName: 'The Scholar',
            targetNewHp: 0,
            targetIsConscious: false,
            targetIsDead: false,
            deathSaveFailuresAdded: 1,
            deathSavesFailures: 1,
          },
        ],
      },
      FIGHT_ROSTER,
      ON_YOU,
    );
    const extra = parts[parts.length - 1];
    expect(extra.line).toContain('takes damage at 0 HP');
    expect(extra.line).toContain('one automatic death-save failure');
    expect(extra.card.kind).toBe('death_save');
    expect(extra.card.badge).toMatchObject({ word: 'FAILED' });
  });

  it('adds no damage-at-0 line or card when the result carries no failures', () => {
    const parts = formatCombatEngineParts(
      attackAction(REEVES, SCHOLAR),
      ENEMY_HITS_PLAYER,
      FIGHT_ROSTER,
      ON_YOU,
    );
    expect(parts.map((part) => part.line).join('\n')).not.toContain('0 HP');
    expect(parts.some((part) => part.line.includes('death-save failure'))).toBe(false);
  });

  it('asserts the whole payload carries no DM-facing instructions', () => {
    const parts = formatCombatEngineParts(
      attackAction(REEVES, SCHOLAR),
      CRIT_AT_ZERO_HP,
      FIGHT_ROSTER,
      ON_YOU,
    );
    assertNoDmInstructions(payloadStrings(parts));
  });
});

describe('formatDeathSaveParts (#2457)', () => {
  // Producer: the server's DeathSaveResult, settled at the turn boundary
  // (server-bun/src/services/combat/death-saves-service.ts); the client sees it as
  // `deathSaves` on a single executed action's engine result.
  const withSaves = (deathSaves: unknown[]): Record<string, unknown> => ({
    ...ENEMY_HITS_PLAYER,
    deathSaves,
  });

  it('gives a natural 1 save a line naming the two failures, plus its card', () => {
    const parts = formatDeathSaveParts(
      withSaves([{ ...DEATH_SAVE_FAILED, roll: 1, isCritical: true, failures: 2 }]),
      FIGHT_ROSTER,
    );
    expect(parts).toHaveLength(1);
    // The Engine: prefix marks this as engine fact, not DM fiction (#2457).
    expect(parts[0].line.startsWith('⚙️ Engine:')).toBe(true);
    expect(parts[0].line).toContain('natural 1');
    expect(parts[0].line).toContain('two failures');
    expect(parts[0].card.kind).toBe('death_save');
    expect(parts[0].card.title).toContain('death saving throw');
    expect(parts[0].card.badge).toMatchObject({ word: 'FAILED' });
    expect(parts[0].card.line).toBe(parts[0].line);
  });

  it('gives a natural 20 save a revival line and a passed card', () => {
    const parts = formatDeathSaveParts(
      withSaves([
        {
          ...DEATH_SAVE_FAILED,
          roll: 20,
          isSuccess: true,
          isCritical: true,
          wasRevived: true,
        },
      ]),
      FIGHT_ROSTER,
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].line).toContain('natural 20');
    expect(parts[0].line).toContain('1 HP');
    expect(parts[0].card.badge).toMatchObject({ word: 'PASSED' });
  });

  it('gives every save in the round its own line and card', () => {
    const parts = formatDeathSaveParts(
      withSaves([DEATH_SAVE_FAILED, DEATH_SAVE_PASSED]),
      FIGHT_ROSTER,
    );
    expect(parts).toHaveLength(2);
    expect(parts[0].line).toContain('FAILURE');
    expect(parts[1].line).toContain('SUCCESS');
  });

  it('skips saves with no roll', () => {
    expect(formatDeathSaveParts(withSaves([{}]), FIGHT_ROSTER)).toHaveLength(0);
  });

  it('asserts the whole payload carries no DM-facing instructions', () => {
    const parts = formatDeathSaveParts(
      withSaves([
        DEATH_SAVE_FAILED,
        { ...DEATH_SAVE_FAILED, roll: 1, isCritical: true, failures: 2 },
        { ...DEATH_SAVE_FAILED, roll: 20, isSuccess: true, isCritical: true, wasRevived: true },
        { ...DEATH_SAVE_FAILED, isDead: true, failures: 3 },
      ]),
      FIGHT_ROSTER,
    );
    assertNoDmInstructions(payloadStrings(parts));
  });
});

describe('three-round death-save arc through the real client path (#2457)', () => {
  // A downed PC over three rounds: each round's engine result carries one save, formatted
  // through formatDeathSaveParts — the same function settleExecutedAction calls. A hit at
  // 0 HP in round 2 adds a separate failure line via formatCombatEngineParts.
  const ROUND_SAVES = [
    { ...DEATH_SAVE_FAILED, roll: 12, isSuccess: true, successes: 1, failures: 0 },
    { ...DEATH_SAVE_FAILED, roll: 8, isSuccess: false, successes: 1, failures: 1 },
    { ...DEATH_SAVE_FAILED, roll: 15, isSuccess: true, successes: 2, failures: 1 },
  ];
  const withSave = (save: unknown): Record<string, unknown> => ({
    ...ENEMY_HITS_PLAYER,
    deathSaves: [save],
  });

  it('gives one visible line per save in order, with the engine prefix', () => {
    const allParts = ROUND_SAVES.flatMap((save) =>
      formatDeathSaveParts(withSave(save), FIGHT_ROSTER),
    );
    expect(allParts).toHaveLength(3);
    // One line per round, in order.
    expect(allParts[0].line).toContain('rolled 12');
    expect(allParts[1].line).toContain('rolled 8');
    expect(allParts[2].line).toContain('rolled 15');
    // Every line carries the engine prefix.
    for (const part of allParts) {
      expect(part.line.startsWith('⚙️ Engine:')).toBe(true);
    }
    // No DM-facing instructions anywhere in the payload.
    assertNoDmInstructions(payloadStrings(allParts));
  });

  it('adds a separate failure line for a hit at 0 HP', () => {
    const hitAtZero: Record<string, unknown> = {
      ...ENEMY_HITS_PLAYER,
      finalDamage: 5,
      targetNewHp: 0,
      targetIsConscious: false,
      deathSaveFailuresAdded: 1,
      deathSavesFailures: 2,
    };
    const parts = formatCombatEngineParts(
      attackAction(REEVES, SCHOLAR),
      hitAtZero,
      FIGHT_ROSTER,
      { targetHp: true, targetMaxHp: 7 },
    );
    const failurePart = parts[parts.length - 1];
    expect(failurePart.line.startsWith('⚙️ Engine:')).toBe(true);
    expect(failurePart.line).toContain('takes damage at 0 HP');
    expect(failurePart.line).toContain('one automatic death-save failure');
    expect(failurePart.card.kind).toBe('death_save');
    assertNoDmInstructions(payloadStrings(parts));
  });

  it('final card tally equals the visible lines', () => {
    const allParts = ROUND_SAVES.flatMap((save) =>
      formatDeathSaveParts(withSave(save), FIGHT_ROSTER),
    );
    const lastCard = allParts[allParts.length - 1].card;
    // The final card's tally (2 successes, 1 failure) matches the three visible lines.
    expect(lastCard.deathSave).toMatchObject({ successes: 2, failures: 1 });
    // Each card's line matches its visible line.
    for (const part of allParts) {
      expect(part.card.line).toBe(part.line);
    }
  });

  it('a lethal third failure produces a DEAD line with the engine prefix', () => {
    // BLOCKING 1: an end_turn that returns a lethal third-failure save plus the
    // combat-ended marker must still print the DEAD line and card.
    const lethalSave = {
      ...DEATH_SAVE_FAILED,
      roll: 5,
      isSuccess: false,
      successes: 0,
      failures: 3,
      isDead: true,
    };
    const parts = formatDeathSaveParts(withSave(lethalSave), FIGHT_ROSTER);
    expect(parts).toHaveLength(1);
    expect(parts[0].line.startsWith('⚙️ Engine:')).toBe(true);
    expect(parts[0].line).toContain('DEAD');
    expect(parts[0].line).toContain('third failure');
    assertNoDmInstructions(payloadStrings(parts));
  });

});
