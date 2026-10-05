import { describe, expect, it } from 'bun:test';

import { describeRefusedSpell, describeResolvedSpell } from '../attack-narration.js';

describe('spell engine narration', () => {
  it('reports a saving-throw cantrip hit with the save and damage', () => {
    expect(
      describeResolvedSpell(
        'Rook',
        'Professor Umeboshi',
        'Acid Splash',
        {
          saveAbility: 'dexterity',
          saveRoll: 9,
          saveDC: 13,
          saved: false,
          finalDamage: 4,
          damageType: 'acid',
          targetNewHp: 6,
          targetIsConscious: false,
          targetIsDead: false,
        },
        true,
      ),
    ).toBe(
      'Rook cast Acid Splash at Professor Umeboshi — DEX save 9 vs DC 13 — FAIL. 4 acid damage. Professor Umeboshi is now at 6 HP and is UNCONSCIOUS. Narrate this outcome; it already happened.',
    );
  });

  it('reports a spell attack miss without inventing damage', () => {
    expect(
      describeResolvedSpell(
        'Rook',
        'Professor Umeboshi',
        'Fire Bolt',
        {
          d20: 3,
          attackBonus: 5,
          totalAttackRoll: 8,
          targetAC: 12,
          hit: false,
          finalDamage: 0,
          damageType: 'fire',
        },
        true,
      ),
    ).toBe(
      'Rook cast Fire Bolt at Professor Umeboshi — spell attack 3 + 5 = 8 vs AC 12 — MISS. No damage. Narrate this outcome; it already happened.',
    );
  });

  it('reports a spell attack hit with the engine roll and damage', () => {
    expect(
      describeResolvedSpell(
        'Rook',
        'Professor Umeboshi',
        'Fire Bolt',
        {
          d20: 17,
          attackBonus: 5,
          totalAttackRoll: 22,
          targetAC: 12,
          hit: true,
          finalDamage: 6,
          damageType: 'fire',
          targetNewHp: 4,
          targetIsConscious: true,
          targetIsDead: false,
        },
        true,
      ),
    ).toBe(
      'Rook cast Fire Bolt at Professor Umeboshi — spell attack 17 + 5 = 22 vs AC 12 — HIT. 6 fire damage. Professor Umeboshi is now at 4 HP. Narrate this outcome; it already happened.',
    );
  });

  it('reports a passed saving throw without inventing damage', () => {
    expect(
      describeResolvedSpell(
        'Rook',
        'Professor Umeboshi',
        'Sacred Flame',
        {
          saveAbility: 'dexterity',
          saveRoll: 14,
          saveDC: 13,
          saved: true,
          finalDamage: 0,
          damageType: 'radiant',
          targetNewHp: 10,
          targetIsConscious: true,
          targetIsDead: false,
        },
        true,
      ),
    ).toBe(
      'Rook cast Sacred Flame at Professor Umeboshi — DEX save 14 vs DC 13 — PASS. No damage. Professor Umeboshi is now at 10 HP. Narrate this outcome; it already happened.',
    );
  });

  it('reports Magic Missile as an auto-hit', () => {
    expect(
      describeResolvedSpell(
        'Rook',
        'Professor Umeboshi',
        'Magic Missile',
        {
          autoHit: true,
          finalDamage: 8,
          damageType: 'force',
          targetNewHp: 0,
          targetIsConscious: false,
          targetIsDead: true,
        },
        true,
      ),
    ).toBe(
      'Rook cast Magic Missile at Professor Umeboshi — AUTO-HIT. 8 force damage. Professor Umeboshi is now at 0 HP and is DEAD. Narrate this outcome; it already happened.',
    );
  });

  it('reports a clear refusal for an unknown spell', () => {
    expect(describeRefusedSpell('Rook', 'Meteor Swarm', 'unknown spell')).toBe(
      'Engine: Rook\'s spell "Meteor Swarm" was refused (unknown spell). No roll, no damage, no wound.',
    );
  });

  it('hides the DC from the DM when target numbers are off', () => {
    const line = describeResolvedSpell(
      'Rook',
      'Professor Umeboshi',
      'Acid Splash',
      {
        saveAbility: 'dexterity',
        saveRoll: 9,
        saveDC: 13,
        saved: false,
        finalDamage: 4,
        damageType: 'acid',
        targetNewHp: 6,
        targetIsConscious: false,
        targetIsDead: false,
      },
      false,
    );
    expect(line).toBe(
      'Rook cast Acid Splash at Professor Umeboshi — DEX save 9 — FAIL. 4 acid damage. Professor Umeboshi is now at 6 HP and is UNCONSCIOUS. Narrate this outcome; it already happened.',
    );
    expect(line).not.toContain('vs DC');
    expect(line).not.toContain('13');
    expect(line).not.toContain('?');
  });

  it('hides the AC from the DM when target numbers are off', () => {
    const line = describeResolvedSpell(
      'Rook',
      'Professor Umeboshi',
      'Fire Bolt',
      {
        d20: 17,
        attackBonus: 5,
        totalAttackRoll: 22,
        targetAC: 12,
        hit: true,
        finalDamage: 6,
        damageType: 'fire',
        targetNewHp: 4,
        targetIsConscious: true,
        targetIsDead: false,
      },
      false,
    );
    expect(line).toBe(
      'Rook cast Fire Bolt at Professor Umeboshi — spell attack 17 + 5 = 22 — HIT. 6 fire damage. Professor Umeboshi is now at 4 HP. Narrate this outcome; it already happened.',
    );
    expect(line).not.toContain('vs AC');
    expect(line).not.toContain('12');
    expect(line).not.toContain('?');
  });

  it('hides the AC on a miss when target numbers are off', () => {
    const line = describeResolvedSpell(
      'Rook',
      'Professor Umeboshi',
      'Fire Bolt',
      {
        d20: 3,
        attackBonus: 5,
        totalAttackRoll: 8,
        targetAC: 12,
        hit: false,
        finalDamage: 0,
        damageType: 'fire',
      },
      false,
    );
    expect(line).toBe(
      'Rook cast Fire Bolt at Professor Umeboshi — spell attack 3 + 5 = 8 — MISS. No damage. Narrate this outcome; it already happened.',
    );
    expect(line).not.toContain('vs AC');
    expect(line).not.toContain('12');
    expect(line).not.toContain('?');
  });

  it('drops the AC clause rather than printing "vs AC ?" when the AC is unknown', () => {
    const line = describeResolvedSpell(
      'Rook',
      'Professor Umeboshi',
      'Fire Bolt',
      {
        d20: 17,
        attackBonus: 5,
        totalAttackRoll: 22,
        hit: true,
        finalDamage: 6,
        damageType: 'fire',
        targetNewHp: 4,
        targetIsConscious: true,
        targetIsDead: false,
      },
      true,
    );
    expect(line).toBe(
      'Rook cast Fire Bolt at Professor Umeboshi — spell attack 17 + 5 = 22 — HIT. 6 fire damage. Professor Umeboshi is now at 4 HP. Narrate this outcome; it already happened.',
    );
    expect(line).not.toContain('vs AC');
    expect(line).not.toContain('?');
  });
});
