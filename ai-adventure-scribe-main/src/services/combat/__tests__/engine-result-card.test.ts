import { describe, expect, it } from 'vitest';

import {
  attackAction,
  DEATH_SAVE_FAILED,
  DEATH_SAVE_PASSED,
  ENEMY_CRITS_PLAYER,
  ENEMY_FAILS_SAVE,
  ENEMY_HITS_PLAYER,
  ENEMY_MISSES_PLAYER,
  ENEMY_MOVES_WITHOUT_ATTACKING,
  ENEMY_SAVE_SPELL_HITS_PLAYER,
  ENEMY_SAVES,
  ENEMY_SWAPS_WEAPON,
  FIGHT_ROSTER,
  PLAYER_CRITS_ENEMY,
  PLAYER_HEALS_ALLY,
  PLAYER_HITS_BEHIND_COVER,
  PLAYER_HITS_ENEMY,
  PLAYER_MAGIC_MISSILE,
  PLAYER_MISSES_ENEMY,
  PLAYER_SPELL_ATTACK_HITS,
  PLAYER_SPELL_ATTACK_MISSES,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../../shared/test-fixtures/engine-results';
import {
  formatCombatEngineParts,
  formatNpcTurnOutcome,
  formatRefusedSpellPart,
  type EngineTranscriptPart,
} from '../combat-outcome-transcript';
import {
  engineCardAriaLabel,
  engineCardMathText,
  initiativeCard,
  isEngineResultCard,
  type EngineBadge,
  type EngineResultCard,
} from '../engine-result-card';

import { summarizeEngineLine } from '@/features/game-session/components/game/EngineOutcomeChip';

const ON_YOU = { targetHp: true, targetMaxHp: 7 };

const attacksPlayer = (value: unknown) =>
  formatCombatEngineParts(attackAction(REEVES, SCHOLAR), value, FIGHT_ROSTER, ON_YOU);
const attacksEnemy = (value: unknown) =>
  formatCombatEngineParts(attackAction(SCHOLAR, REEVES), value, FIGHT_ROSTER);
const castsAtEnemy = (value: unknown) =>
  formatCombatEngineParts(spellAction(SCHOLAR, REEVES), value, FIGHT_ROSTER);

const only = (parts: EngineTranscriptPart[]): EngineResultCard => {
  expect(parts).toHaveLength(1);
  return parts[0].card;
};

const badge = (
  word: EngineBadge['word'],
  tone: EngineBadge['tone'],
  icon: EngineBadge['icon'],
) => ({
  word,
  tone,
  icon,
});

/** Spec table on #2393, one row per case, read through the real producers. */
const BADGE_TABLE: Array<[string, () => EngineResultCard, EngineBadge]> = [
  [
    'your attack misses',
    () => only(attacksEnemy(PLAYER_MISSES_ENEMY)),
    badge('MISS', 'grey', 'dash'),
  ],
  ['your attack hits', () => only(attacksEnemy(PLAYER_HITS_ENEMY)), badge('HIT', 'gold', 'check')],
  [
    'an enemy attack hits you',
    () => only(attacksPlayer(ENEMY_HITS_PLAYER)),
    badge('HIT', 'red', 'alert'),
  ],
  [
    'an enemy attack misses you',
    () => only(attacksPlayer(ENEMY_MISSES_PLAYER)),
    badge('MISS', 'grey', 'dash'),
  ],
  [
    'a natural 20 by you',
    () => only(attacksEnemy(PLAYER_CRITS_ENEMY)),
    badge('CRITICAL HIT', 'gold', 'check'),
  ],
  [
    'a natural 20 by the enemy',
    () => only(attacksPlayer(ENEMY_CRITS_PLAYER)),
    badge('CRITICAL HIT', 'red', 'alert'),
  ],
  [
    'an auto-hit spell',
    () => only(castsAtEnemy(PLAYER_MAGIC_MISSILE)),
    badge('AUTO-HIT', 'gold', 'check'),
  ],
  [
    'a save spell, the target fails',
    () => only(castsAtEnemy(ENEMY_FAILS_SAVE)),
    badge('TARGET FAILED', 'gold', 'check'),
  ],
  [
    'a save spell, the target saves',
    () => only(castsAtEnemy(ENEMY_SAVES)),
    badge('TARGET SAVED', 'grey', 'dash'),
  ],
  [
    'a spell attack roll that hits',
    () => only(castsAtEnemy(PLAYER_SPELL_ATTACK_HITS)),
    badge('HIT', 'gold', 'check'),
  ],
  [
    'a spell attack roll that misses',
    () => only(castsAtEnemy(PLAYER_SPELL_ATTACK_MISSES)),
    badge('MISS', 'grey', 'dash'),
  ],
  [
    'an enemy save spell the player fails',
    () =>
      only(
        formatCombatEngineParts(
          spellAction(REEVES, SCHOLAR),
          ENEMY_SAVE_SPELL_HITS_PLAYER,
          FIGHT_ROSTER,
          ON_YOU,
        ),
      ),
    badge('TARGET FAILED', 'red', 'alert'),
  ],
  [
    'a spell refused',
    () =>
      formatRefusedSpellPart(SCHOLAR.id, 'Chill Touch', 'it is not your turn', FIGHT_ROSTER).card,
    badge('REFUSED', 'grey', 'dash'),
  ],
  ['a death save failed', () => deathSaveCard(DEATH_SAVE_FAILED), badge('FAILED', 'red', 'alert')],
  ['a death save passed', () => deathSaveCard(DEATH_SAVE_PASSED), badge('PASSED', 'gold', 'check')],
];

function deathSaveCard(save: typeof DEATH_SAVE_FAILED): EngineResultCard {
  const turn = {
    action: attackAction(REEVES, SCHOLAR),
    engineResult: { ...ENEMY_MISSES_PLAYER, deathSaves: [save] },
    transcriptLines: ['The Scholar rolled 6 on their death saving throw — FAILURE.'],
  };
  const card = formatNpcTurnOutcome(turn, FIGHT_ROSTER, ON_YOU).cards.find(
    (candidate) => candidate.kind === 'death_save',
  );
  if (!card) throw new Error('no death save card');
  return card;
}

describe('engine result card badges (#2417)', () => {
  it.each(BADGE_TABLE)('%s', (_name, build, expected) => {
    expect(build().badge).toEqual(expected);
  });

  it('never paints a miss, a save, a refusal or a failed death save gold', () => {
    const words = new Set(['MISS', 'TARGET SAVED', 'REFUSED']);
    for (const [, build] of BADGE_TABLE) {
      const { badge: b } = build();
      if (b && words.has(b.word)) expect(b.tone).toBe('grey');
    }
    expect(deathSaveCard(DEATH_SAVE_FAILED).badge?.tone).toBe('red');
  });

  it('gives every result that has a chip a card with the table badge word', () => {
    const chipToBadge: Record<string, string> = {
      HIT: 'HIT',
      MISS: 'MISS',
      'CRITICAL HIT': 'CRITICAL HIT',
      'AUTO-HIT': 'AUTO-HIT',
      PASS: 'TARGET SAVED',
      FAIL: 'TARGET FAILED',
      REFUSED: 'REFUSED',
    };
    const parts = [
      ...attacksEnemy(PLAYER_HITS_ENEMY),
      ...attacksEnemy(PLAYER_MISSES_ENEMY),
      ...attacksEnemy(PLAYER_CRITS_ENEMY),
      ...attacksPlayer(ENEMY_HITS_PLAYER),
      ...attacksPlayer(ENEMY_MISSES_PLAYER),
      ...attacksPlayer(ENEMY_CRITS_PLAYER),
      ...castsAtEnemy(PLAYER_SPELL_ATTACK_HITS),
      ...castsAtEnemy(PLAYER_SPELL_ATTACK_MISSES),
      ...castsAtEnemy(PLAYER_MAGIC_MISSILE),
      ...castsAtEnemy(ENEMY_FAILS_SAVE),
      ...castsAtEnemy(ENEMY_SAVES),
      formatRefusedSpellPart(SCHOLAR.id, 'Chill Touch', 'it is not your turn', FIGHT_ROSTER),
    ];
    for (const part of parts) {
      const { outcome } = summarizeEngineLine(part.line);
      expect(chipToBadge[outcome], part.line).toBeDefined();
      expect(part.card.badge?.word, part.line).toBe(chipToBadge[outcome]);
    }
  });
});

describe('engine result card data (#2417)', () => {
  it('reads the math from the result fields and names both sides by display name', () => {
    const card = only(attacksPlayer(ENEMY_HITS_PLAYER));

    expect(card.title).toBe('Captain Sarah Reeves attacks The Scholar with Longsword');
    expect(card.side).toBe('enemy');
    expect(engineCardMathText(card.math!, true)).toBe('d20 14 + 0 = 14 vs your AC 11');
    expect(card.effect).toBe('3 slashing damage');
  });

  it('shows the player their own HP when they are hit, and an enemy only the words it gave', () => {
    expect(only(attacksPlayer(ENEMY_HITS_PLAYER)).hp).toEqual({
      name: 'The Scholar',
      newHp: 4,
      lost: 3,
      maxHp: 7,
    });
    const onEnemy = only(attacksEnemy(PLAYER_HITS_ENEMY));
    expect(onEnemy.hp).toBeUndefined();
    expect(onEnemy.status).toBe('Captain Sarah Reeves is bloodied.');
    expect(only(castsAtEnemy(PLAYER_SPELL_ATTACK_HITS)).status).toBe(
      'Captain Sarah Reeves is now at 9 HP.',
    );
  });

  it('words a save as `DEX save 6 vs DC 14` and gives a miss `No damage.`', () => {
    const save = only(castsAtEnemy(ENEMY_FAILS_SAVE));
    expect(save.title).toBe('The Scholar casts Acid Splash at Captain Sarah Reeves');
    expect(engineCardMathText(save.math!, true)).toBe('DEX save 6 vs DC 14');
    expect(save.effect).toBe('2 acid damage');
    expect(only(attacksEnemy(PLAYER_MISSES_ENEMY)).effect).toBe('No damage.');
    expect(only(castsAtEnemy(ENEMY_SAVES)).effect).toBe('No damage.');
  });

  it('puts cover in the math line: AC 14 (12 + 2 half cover)', () => {
    const card = only(attacksEnemy(PLAYER_HITS_BEHIND_COVER));
    expect(engineCardMathText(card.math!, true)).toBe(
      'd20 14 + 0 = 14 vs AC 14 (12 + 2 half cover)',
    );
  });

  it('turns a heal into HEALS in gold', () => {
    const card = only(
      formatCombatEngineParts(spellAction(SCHOLAR, SCHOLAR), PLAYER_HEALS_ALLY, FIGHT_ROSTER),
    );
    expect(card.badge).toEqual(badge('HEALS', 'gold', 'check'));
  });

  it('gives a light card, with no badge or math, to a move and a weapon swap', () => {
    const move = only(attacksPlayer(ENEMY_MOVES_WITHOUT_ATTACKING));
    expect(move.title).toBe(
      'Captain Sarah Reeves moves 30 ft toward The Scholar. No attack this turn.',
    );
    expect(move.kind).toBe('move');
    expect(move.badge ?? move.math).toBeUndefined();

    const parts = attacksPlayer(ENEMY_SWAPS_WEAPON);
    expect(parts.map((part) => part.card.kind)).toEqual(['weapon_swap', 'attack']);
    expect(parts[0].card.title).toBe('Captain Sarah Reeves swaps Greatsword for Longsword');
    expect(parts[0].card.badge).toBeUndefined();
  });

  it('builds a death save card from the result, and keeps the server line from printing twice', () => {
    const printed =
      'The Scholar rolled 6 on their death saving throw — FAILURE (0 successes, 2 failures).';
    const { lines, cards } = formatNpcTurnOutcome(
      {
        action: attackAction(REEVES, SCHOLAR),
        engineResult: { ...ENEMY_MISSES_PLAYER, deathSaves: [DEATH_SAVE_FAILED] },
        transcriptLines: [printed],
      },
      FIGHT_ROSTER,
      ON_YOU,
    );
    const card = cards.find((candidate) => candidate.kind === 'death_save')!;

    expect(lines).toContain(printed);
    expect(card.covers).toEqual([printed]);
    expect(card.deathSave).toEqual({ successes: 0, failures: 2 });
    expect(card.title).toBe('The Scholar makes a death saving throw');
  });

  it('builds the seating card from the seated participants, in turn order', () => {
    const card = initiativeCard(
      [
        { id: REEVES.id, name: REEVES.name, initiative: 4, turnOrder: 1, participantType: 'enemy' },
        {
          id: SCHOLAR.id,
          name: SCHOLAR.name,
          initiative: 9,
          turnOrder: 0,
          participantType: 'player',
        },
      ],
      '⚙️ Engine: Initiative — You: 9 + 0 = 9. Captain Sarah Reeves: 4 + 0 = 4.',
    );

    expect(card?.initiative?.order.map((entry) => `${entry.name} ${entry.initiative}`)).toEqual([
      'The Scholar 9',
      'Captain Sarah Reeves 4',
    ]);
    expect(card?.detail).toBe('The Scholar acts first.');
  });
});

describe('target numbers (#2417)', () => {
  it('replaces the AC with ? and drops the DC when the setting is off', () => {
    const attack = only(attacksPlayer(ENEMY_HITS_PLAYER));
    const save = only(castsAtEnemy(ENEMY_FAILS_SAVE));

    expect(engineCardMathText(attack.math!, false)).toBe('d20 14 + 0 = 14 vs your AC ?');
    expect(engineCardMathText(save.math!, false)).toBe('DEX save 6');
    expect(engineCardAriaLabel(attack, false)).toContain('vs AC ?');
    expect(engineCardAriaLabel(attack, false)).not.toContain('AC 11');
    expect(engineCardAriaLabel(save, false)).toContain('DEX save 6 — FAIL');
    expect(engineCardAriaLabel(save, false)).not.toContain('DC');
  });

  it('keeps both numbers when the setting is on, and the engine line is the aria label', () => {
    const parts = attacksPlayer(ENEMY_HITS_PLAYER);
    expect(engineCardMathText(parts[0].card.math!, true)).toContain('vs your AC 11');
    expect(engineCardAriaLabel(parts[0].card, true)).toBe(parts[0].line.replace('⚙️ Engine: ', ''));
  });
});

describe('saved cards (#2417)', () => {
  it('accepts a card the producers built and rejects one that would throw when drawn', () => {
    const card = only(attacksPlayer(ENEMY_HITS_PLAYER));

    expect(isEngineResultCard(card)).toBe(true);
    expect(isEngineResultCard({ ...card, math: { kind: 'attack', d20: 1 } })).toBe(false);
    expect(isEngineResultCard({ ...card, math: null })).toBe(false);
    expect(isEngineResultCard({ kind: 'attack', side: 'party', line: 'x' })).toBe(false);
  });
});
