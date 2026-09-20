import { describe, expect, it } from 'vitest';

import {
  formatCombatEngineOutcome,
  formatRefusedSpellOutcome,
  prependCombatEngineTranscript,
} from '../combat-outcome-transcript';

const attack = {
  actor_id: 'the-seeker',
  action_type: 'attack',
  target_ids: ['balthazar'],
};

describe('combat outcome transcript', () => {
  it('reports the authoritative roll, AC, damage, condition, and auto-roll tag', () => {
    const line = formatCombatEngineOutcome(attack, {
      actorName: 'The Seeker',
      targetName: 'Balthazar',
      d20: 12,
      attackBonus: 4,
      totalAttackRoll: 16,
      targetAC: 12,
      hit: true,
      finalDamage: 3,
      damageType: 'slashing',
      targetNewHp: 8,
      targetCondition: 'bloodied',
      autoRolled: true,
      weaponResolution: {
        requested: 'cleaver',
        resolved: 'Unarmed Strike',
        substituted: true,
      },
    });

    expect(line).toContain('12 + 4 = 16 vs AC 12');
    expect(line).toContain('HIT (auto-rolled)');
    expect(line).toContain('3 slashing damage');
    expect(line).toContain('Balthazar is bloodied');
    expect(line).not.toContain('8 HP');
  });

  it('reports a miss and does not invent damage or a condition', () => {
    const line = formatCombatEngineOutcome(attack, {
      actorName: 'Balthazar',
      targetName: 'The Seeker',
      d20: 2,
      attackBonus: -1,
      totalAttackRoll: 1,
      targetAC: 15,
      hit: false,
      finalDamage: 0,
      autoRolled: false,
      weaponResolution: { resolved: 'Claws', substituted: false },
    });

    expect(line).toContain('2 - 1 = 1 vs AC 15');
    expect(line).toContain('MISS');
    expect(line).toContain('No damage');
    expect(line).not.toContain('is wounded');
  });

  it('reports a weapon substitution and movement without claiming an attack happened', () => {
    const line = formatCombatEngineOutcome(attack, {
      resolvedAs: 'movement_only',
      actorName: 'Balthazar',
      targetName: 'The Seeker',
      movedFeet: 30,
      distanceFeet: 15,
      reachFeet: 5,
      weaponResolution: {
        requested: 'cleaver',
        resolved: 'Unarmed Strike',
        substituted: true,
      },
    });

    expect(line).toContain('cleaver');
    expect(line).toContain('Unarmed Strike');
    expect(line).toContain('distance 15 ft (reach 5 ft)');
    expect(line).toContain('no attack was rolled');
    expect(line).not.toContain('HIT');
  });

  it('keeps engine facts before model prose', () => {
    expect(prependCombatEngineTranscript('The narration.', ['⚙️ Engine: HIT.'])).toBe(
      '⚙️ Engine: HIT.\n\nThe narration.',
    );
    expect(prependCombatEngineTranscript('The narration.', [])).toBe('The narration.');
  });
});

const spell = {
  actor_id: 'rook',
  action_type: 'cast_spell',
  target_ids: ['professor-umeboshi'],
};

describe('spell engine lines', () => {
  it('renders an attack-roll spell from engine fields, without inventing damage on a miss', () => {
    const line = formatCombatEngineOutcome(spell, {
      results: [
        {
          actorName: 'Rook',
          targetName: 'Professor Umeboshi',
          spellName: 'Fire Bolt',
          d20: 17,
          attackBonus: 5,
          totalAttackRoll: 22,
          targetAC: 12,
          hit: true,
          finalDamage: 6,
          damageType: 'fire',
        },
      ],
    });

    expect(line).toBe(
      '⚙️ Engine: Rook cast Fire Bolt at Professor Umeboshi — spell attack 17 + 5 = 22 vs AC 12 — HIT. 6 fire damage.',
    );
  });

  it('renders a save spell PASS/FAIL from engine fields', () => {
    const line = formatCombatEngineOutcome(spell, {
      results: [
        {
          actorName: 'Rook',
          targetName: 'Professor Umeboshi',
          spellName: 'Acid Splash',
          saveAbility: 'dex',
          saveRoll: 9,
          saveDC: 13,
          saved: false,
          hit: true,
          finalDamage: 4,
          damageType: 'acid',
        },
      ],
    });

    expect(line).toBe(
      '⚙️ Engine: Rook cast Acid Splash at Professor Umeboshi — DEX save 9 vs DC 13 — FAIL. 4 acid damage.',
    );
  });

  it('renders Magic Missile as AUTO-HIT with engine damage and death', () => {
    const line = formatCombatEngineOutcome(spell, {
      results: [
        {
          actorName: 'Rook',
          targetName: 'Professor Umeboshi',
          spellName: 'Magic Missile',
          autoHit: true,
          hit: true,
          finalDamage: 8,
          damageType: 'force',
          targetNewHp: 0,
          targetIsDead: true,
        },
      ],
    });

    expect(line).toBe(
      '⚙️ Engine: Rook cast Magic Missile at Professor Umeboshi — AUTO-HIT. 8 force damage. Professor Umeboshi is now at 0 HP and is DEAD.',
    );
  });

  it('renders a refused spell with no roll, damage, or wound', () => {
    expect(
      formatRefusedSpellOutcome('Rook', 'Meteor Swarm', 'unknown spell'),
    ).toBe(
      '⚙️ Engine: Rook\'s spell "Meteor Swarm" was refused (unknown spell). No roll, no damage, no wound.',
    );
  });
});

