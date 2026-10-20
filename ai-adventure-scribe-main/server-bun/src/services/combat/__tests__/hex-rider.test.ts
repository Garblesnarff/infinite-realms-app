import { describe, expect, it } from 'bun:test';

import { describeResolvedAttack, describeResolvedSpell } from '../attack-narration.js';
import { appliesHexRider, hexRiderDice } from '../hex-rider.js';

const TARGET = 'participant-cursed';
const OTHER = 'participant-bystander';

describe('Hex rider decision (#754)', () => {
  it('applies while concentrating on Hex against the cursed participant', () => {
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: TARGET }, TARGET)).toBe(true);
  });

  it('is case- and padding-insensitive on the spell name', () => {
    expect(appliesHexRider({ spellName: '  hEx ', targetParticipantId: TARGET }, TARGET)).toBe(
      true,
    );
  });

  it('does not apply against a different participant', () => {
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: TARGET }, OTHER)).toBe(false);
  });

  it('does not apply when the attack has no target', () => {
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: TARGET }, null)).toBe(false);
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: TARGET }, undefined)).toBe(
      false,
    );
  });

  it('does not apply while concentrating on another spell', () => {
    expect(appliesHexRider({ spellName: 'Bless', targetParticipantId: TARGET }, TARGET)).toBe(
      false,
    );
  });

  it('does not apply when the stored Hex has no target', () => {
    expect(appliesHexRider({ spellName: 'Hex', targetParticipantId: null }, TARGET)).toBe(false);
  });

  it('does not apply without concentration', () => {
    expect(appliesHexRider(null, TARGET)).toBe(false);
    expect(appliesHexRider(undefined, TARGET)).toBe(false);
  });
});

describe('Hex rider dice on a critical hit (#754 crit ruling)', () => {
  it('rolls 1d6 on a normal hit and 2d6 on a crit', () => {
    expect(hexRiderDice(false)).toBe('1d6');
    expect(hexRiderDice(true)).toBe('2d6');
  });
});

describe('Hex narration counts the rider once (#754 FIX item 1)', () => {
  it('weapon hit: the rider is named as part of finalDamage, not added after it', () => {
    const line = describeResolvedAttack(
      'Ash',
      'Scavenger 1',
      { hit: true, isCritical: false, finalDamage: 9, hexDamage: 4, targetNewHp: 3 },
      'Dagger',
    );
    expect(line).toContain('for 9 damage (including 4 necrotic from Hex).');
    expect(line).not.toContain('(+ 4');
  });

  it('spell-attack hit: the rider is named on the damage line, not after the hit result', () => {
    const line = describeResolvedSpell(
      'Ash',
      'Scavenger 1',
      'Eldritch Blast',
      {
        hit: true,
        d20: 15,
        attackBonus: 5,
        totalAttackRoll: 20,
        finalDamage: 9,
        hexDamage: 4,
        damageType: 'force',
        targetNewHp: 3,
      },
      false,
    );
    expect(line).toContain('9 force damage (including 4 necrotic from Hex).');
    expect(line).not.toContain('+ 4 necrotic');
  });

  it('no Hex: the line is unchanged', () => {
    const line = describeResolvedAttack('Ash', 'Scavenger 1', {
      hit: true,
      isCritical: false,
      finalDamage: 5,
    });
    expect(line).toContain('for 5 damage.');
    expect(line).not.toContain('Hex');
  });
});
