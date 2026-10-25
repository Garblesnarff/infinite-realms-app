/**
 * EngineLine view model (#87). Every combat line is produced by the real transcript producer
 * (`formatCombatEngineParts`, shared/combat-outcome-transcript.ts) from the shared engine result
 * fixtures (shared/test-fixtures/engine-results.ts), the same way engine-result-card.test.ts reads
 * them. The dice roll is the `context.diceRoll` shape use-message-dice-rolls.ts persists.
 */
import { describe, expect, it } from 'vitest';

import {
  ENEMY_FAILS_SAVE,
  ENEMY_HITS_PLAYER,
  ENEMY_MISSES_PLAYER,
  ENEMY_SAVES,
  FIGHT_ROSTER,
  PLAYER_CRITS_ENEMY,
  PLAYER_HITS_ENEMY,
  PLAYER_MISSES_ENEMY,
  REEVES,
  SCHOLAR,
  attackAction,
  spellAction,
} from '../../../../../../../shared/test-fixtures/engine-results';
import {
  engineLineFromDiceRoll,
  hideEnemyHp,
  isEngineLine,
  parseEngineLine,
  replaceSlugs,
  type EngineRosterRow,
} from '../engine-line-model';

import {
  formatCombatEngineParts,
  formatRefusedSpellPart,
} from '@/services/combat/combat-outcome-transcript';

const ROSTER: EngineRosterRow[] = [
  { id: SCHOLAR.id, name: SCHOLAR.name, participantType: 'player', maxHitPoints: 7 },
  { id: REEVES.id, name: REEVES.name, participantType: 'monster', maxHitPoints: 20 },
];
const ON_YOU = { targetHp: true, targetMaxHp: 7 };

const lineOf = (parts: Array<{ line: string }>): string => {
  expect(parts).toHaveLength(1);
  return parts[0].line;
};
const playerAttacks = (value: unknown) =>
  lineOf(formatCombatEngineParts(attackAction(SCHOLAR, REEVES), value, FIGHT_ROSTER));
const enemyAttacks = (value: unknown) =>
  lineOf(formatCombatEngineParts(attackAction(REEVES, SCHOLAR), value, FIGHT_ROSTER, ON_YOU));
const playerCasts = (value: unknown) =>
  lineOf(formatCombatEngineParts(spellAction(SCHOLAR, REEVES), value, FIGHT_ROSTER));

describe('parseEngineLine (#87): the player point of view, from producer fields', () => {
  it('your hit is a gold Hit with the die, the math and the AC', () => {
    const model = parseEngineLine(playerAttacks(PLAYER_HITS_ENEMY), { side: 'player' });
    expect(model).toMatchObject({
      side: 'player',
      outcome: 'hit',
      pill: 'Hit',
      badge: '14',
      math: '14 + 4 = 18',
      kicker: 'your Longsword attack',
    });
    expect(model.detail).toContain('vs AC 13');
    expect(model.detail).toContain('3 slashing damage');
  });

  it('your critical is Critical, your miss is Miss', () => {
    expect(parseEngineLine(playerAttacks(PLAYER_CRITS_ENEMY), { side: 'player' })).toMatchObject({
      outcome: 'critical',
      pill: 'Critical',
    });
    expect(parseEngineLine(playerAttacks(PLAYER_MISSES_ENEMY), { side: 'player' })).toMatchObject({
      outcome: 'miss',
      pill: 'Miss',
      badge: '5',
    });
  });

  it('an enemy hit on you is a red Hit on a teal badge; its miss is Miss', () => {
    const hit = parseEngineLine(enemyAttacks(ENEMY_HITS_PLAYER), { side: 'npc', roster: ROSTER });
    expect(hit).toMatchObject({
      side: 'npc',
      outcome: 'enemy-hit',
      pill: 'Hit',
      kicker: 'Captain Sarah Reeves attacks you',
    });
    // The player's own HP stays a number: it is theirs to see (#2378).
    expect(hit.sentence).toMatch(/The Scholar is now at 4 HP/);
    expect(
      parseEngineLine(enemyAttacks(ENEMY_MISSES_PLAYER), { side: 'npc', roster: ROSTER }),
    ).toMatchObject({ outcome: 'enemy-miss', pill: 'Miss' });
  });

  it('reads the side from the roster participantType when no block source is given', () => {
    expect(parseEngineLine(enemyAttacks(ENEMY_HITS_PLAYER), { roster: ROSTER }).side).toBe('npc');
    expect(parseEngineLine(playerAttacks(PLAYER_HITS_ENEMY), { roster: ROSTER }).side).toBe(
      'player',
    );
  });

  it('a monster saving against your spell is a muted Saved; failing it is Failed save', () => {
    const saved = parseEngineLine(playerCasts(ENEMY_SAVES), { side: 'player', roster: ROSTER });
    expect(saved).toMatchObject({ outcome: 'saved', pill: 'Saved' });
    expect(saved.detail).toContain('vs DC');
    expect(
      parseEngineLine(playerCasts(ENEMY_FAILS_SAVE), { side: 'player', roster: ROSTER }),
    ).toMatchObject({ outcome: 'failed-save', pill: 'Failed save' });
  });

  it('a refused spell is Refused', () => {
    const part = formatRefusedSpellPart(SCHOLAR.id, 'Meteor Swarm', 'unknown spell', FIGHT_ROSTER);
    expect(parseEngineLine(part.line, { side: 'player' })).toMatchObject({
      outcome: 'refused',
      pill: 'Refused',
      kicker: 'Meteor Swarm',
    });
  });

  it('a move is a "→" row', () => {
    expect(
      parseEngineLine('⚙️ Engine: Captain Sarah Reeves moved to (3, 4).', { side: 'npc' }),
    ).toMatchObject({ outcome: 'move', badge: '→', pill: 'Move' });
  });
});

describe('names and enemy HP (#87 items 2-3)', () => {
  it('never leaves a slug: roster names first, Title Case otherwise', () => {
    const roster: EngineRosterRow[] = [
      { id: 'x', name: 'the-apprentice', displayName: 'The Apprentice', participantType: 'player' },
    ];
    const text = replaceSlugs(
      'the-apprentice cast Acid Splash at flavor-elemental-corrupted',
      roster,
    );
    expect(text).toBe('The Apprentice cast Acid Splash at Flavor Elemental Corrupted');
    expect(text).not.toMatch(/\b[a-z]+(-[a-z0-9]+){2,}\b/);
  });

  it('an enemy HP number becomes a tier; the player keeps theirs', () => {
    expect(hideEnemyHp('Captain Sarah Reeves is now at 20 HP.', ROSTER)).toBe(
      'Captain Sarah Reeves is wounded.',
    );
    expect(hideEnemyHp('Captain Sarah Reeves is now at 6 HP.', ROSTER)).toBe(
      'Captain Sarah Reeves is bloodied.',
    );
    expect(hideEnemyHp('Captain Sarah Reeves is now at 0 HP.', ROSTER)).toBe(
      'Captain Sarah Reeves is down.',
    );
    expect(hideEnemyHp('The Scholar is now at 4 HP.', ROSTER)).toBe('The Scholar is now at 4 HP.');
  });

  it('isEngineLine is true only for a single bare engine line', () => {
    expect(isEngineLine('⚙️ Engine: The Goblin is prone.')).toBe(true);
    expect(isEngineLine('⚙️ Engine: a\n⚙️ Engine: b')).toBe(false);
    expect(isEngineLine('The Goblin is prone.')).toBe(false);
  });
});

describe('engineLineFromDiceRoll (#87 item 5): the persisted check renders the same row', () => {
  const check = {
    formula: '1d20+3',
    count: 1,
    dieType: 20,
    modifier: 3,
    advantage: false,
    disadvantage: false,
    results: [11],
    total: 14,
    naturalRoll: 11,
    requestType: 'skill_check',
    description: 'Investigation check',
    dc: 14,
    success: true,
    timestamp: '2026-10-25T00:00:00.000Z',
  };

  it('shows die + modifier = total and the DC, with Pass', () => {
    expect(engineLineFromDiceRoll(check)).toMatchObject({
      badge: '11',
      side: 'player',
      kicker: 'Investigation check',
      math: '11 + 3 = 14',
      detail: 'vs DC 14',
      outcome: 'pass',
      pill: 'Pass',
    });
  });

  it('a failed check is Fail, and a JSON round trip (reload) gives the same row', () => {
    const failed = { ...check, results: [4], naturalRoll: 4, total: 7, success: false };
    const reloaded = JSON.parse(JSON.stringify(failed)) as typeof failed;
    expect(engineLineFromDiceRoll(reloaded)).toEqual(engineLineFromDiceRoll(failed));
    expect(engineLineFromDiceRoll(failed)).toMatchObject({ outcome: 'fail', pill: 'Fail' });
  });
});
