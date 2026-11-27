import { describe, expect, test } from 'bun:test';

import { defaultLethalActProposal, resolveLethalAct } from '../lethal-act-resolution.js';

import type { CharacterVitals } from '../../character-vitals-math.js';

const standing = (hp: number): CharacterVitals => ({
  characterId: 'hero-1',
  currentHitPoints: hp,
  maxHitPoints: hp,
  temporaryHitPoints: 0,
  isConscious: true,
  deathSavesSuccesses: 0,
  deathSavesFailures: 0,
  vitalState: 'standing',
  diedAt: null,
});

describe('defaultLethalActProposal (#468)', () => {
  test('poison is a Constitution save at DC 15', () => {
    const proposal = defaultLethalActProposal('I drink poison to kill myself');
    expect(proposal).toEqual({
      kind: 'saving_throw',
      ability: 'constitution',
      dc: 15,
      purpose: 'Constitution saving throw',
    });
  });

  test('a fall is a Dexterity save at DC 15', () => {
    const proposal = defaultLethalActProposal('I step off the edge to my death');
    expect(proposal.ability).toBe('dexterity');
    expect(proposal.dc).toBe(15);
  });
});

describe('resolveLethalAct (#468)', () => {
  const proposal = defaultLethalActProposal('I step off the edge to my death');
  // Ability score 10 → modifier 0, so the natural die is the total.

  test('a seeded success leaves the character unharmed', () => {
    const result = resolveLethalAct({
      proposal,
      abilityScore: 10,
      vitals: standing(20),
      natural: 15,
    });
    expect(result.success).toBe(true);
    expect(result.total).toBe(15);
    expect(result.dc).toBe(15);
    expect(result.damage).toBe(0);
    expect(result.vitals.currentHitPoints).toBe(20);
    expect(result.vitals.vitalState).toBe('standing');
    expect(result.engineCard.line).toContain('15 vs DC 15, SUCCESS');
    expect(result.engineCard.badge?.word).toBe('SUCCESS');
  });

  test('a seeded failure is the engine that kills, via 2014 massive damage', () => {
    const result = resolveLethalAct({
      proposal,
      abilityScore: 10,
      vitals: standing(20),
      natural: 14,
    });
    expect(result.success).toBe(false);
    expect(result.total).toBe(14);
    // current 20 + max 20: drop to 0 with leftover 20, which equals the maximum.
    expect(result.damage).toBe(40);
    expect(result.vitals.currentHitPoints).toBe(0);
    expect(result.vitals.vitalState).toBe('dead');
    expect(result.engineCard.line).toContain('14 vs DC 15, FAIL');
    expect(result.engineCard.badge?.word).toBe('FAIL');
  });

  test('the modifier comes from the 2014 ability score, not the client', () => {
    // Dex 16 is +3; a natural 12 meets DC 15.
    const result = resolveLethalAct({
      proposal,
      abilityScore: 16,
      vitals: standing(12),
      natural: 12,
    });
    expect(result.modifier).toBe(3);
    expect(result.total).toBe(15);
    expect(result.success).toBe(true);
  });
});
