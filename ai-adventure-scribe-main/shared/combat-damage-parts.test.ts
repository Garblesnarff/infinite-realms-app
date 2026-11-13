import { describe, expect, it } from 'bun:test';

import { type CombatEngineResult, formatCombatEngineOutcome } from './combat-outcome-transcript';
import { damageEffectText } from './engine-result-card';

/** A Smite hit as the attack resolver reports it: 7 weapon slashing + 11 radiant from 2d8. */
const SMITE_HIT: CombatEngineResult = {
  resolvedAs: 'attack',
  actorName: 'Esme Aldgate',
  targetName: 'Orc',
  d20: 15,
  attackBonus: 5,
  totalAttackRoll: 20,
  targetAC: 13,
  hit: true,
  isCritical: false,
  finalDamage: 18,
  damageType: 'slashing',
  damageParts: [
    { damageType: 'slashing', amount: 7 },
    { damageType: 'radiant', amount: 11, source: 'Divine Smite', dice: '2d8' },
  ],
  targetNewHp: 482,
  targetIsConscious: true,
  targetIsDead: false,
};

const ACTION = { actor_id: 'paladin-1', action_type: 'attack', target_id: 'orc-1' };
const ROSTER = [
  { id: 'paladin-1', name: 'Esme Aldgate', participantType: 'player' },
  { id: 'orc-1', name: 'Orc', participantType: 'monster' },
];

describe('Divine Smite damage parts (#1522)', () => {
  it('the card effect line names both parts and the total', () => {
    expect(damageEffectText(SMITE_HIT)).toBe(
      '7 slashing + 11 radiant (Divine Smite 2d8) = 18 damage',
    );
  });

  it('the engine line names both parts and does not label the whole total as weapon damage', () => {
    const line = formatCombatEngineOutcome(ACTION, SMITE_HIT, ROSTER) ?? '';
    expect(line).toContain('7 slashing + 11 radiant (Divine Smite 2d8) = 18 damage.');
    expect(line).not.toContain('18 slashing damage');
  });

  it('a hit with no rider keeps the single-type line', () => {
    const plain: CombatEngineResult = { ...SMITE_HIT, finalDamage: 7, damageParts: undefined };
    expect(damageEffectText(plain)).toBe('7 slashing damage');
    expect(formatCombatEngineOutcome(ACTION, plain, ROSTER) ?? '').toContain('7 slashing damage.');
  });
});
