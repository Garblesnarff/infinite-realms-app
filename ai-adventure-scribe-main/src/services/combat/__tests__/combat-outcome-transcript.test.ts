import { describe, expect, it } from 'vitest';

import { buildNpcEngineMessage } from '../../../../shared/npc-engine-message';
import { DEATH_SAVE_FAILED } from '../../../../shared/test-fixtures/engine-results';
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

  /**
   * Fixtures follow the producer, `CombatAttackService` save-spell branch: every field it always
   * sets, including the attack-shaped ones (`hit` is `!saved`, `targetAC` 0, the save roll in
   * `totalAttackRoll`), and no `actorName` / `targetName`; the names come from the roster.
   */
  const areaSaveResult = (overrides: Record<string, unknown>) => ({
    hit: true,
    targetAC: 0,
    totalAttackRoll: 6,
    damage: 7,
    damageType: 'fire',
    damageBeforeResistances: 7,
    effectiveResistance: false,
    effectiveVulnerability: false,
    effectiveImmunity: false,
    finalDamage: 7,
    targetNewHp: 4,
    targetIsConscious: true,
    targetIsDead: false,
    targetCondition: 'bloodied',
    isCritical: false,
    isNaturalOne: false,
    isNaturalTwenty: false,
    spellName: 'Burning Hands',
    saveAbility: 'dexterity',
    saveRoll: 6,
    saveDC: 13,
    saved: false,
    ...overrides,
  });
  const areaRoster = [
    { id: 'rook', name: 'Rook' },
    { id: 'goblin-1', name: 'Goblin Archer' },
    { id: 'goblin-2', name: 'Goblin Boss' },
  ];

  it('names each result of an area spell after its own target', () => {
    const line = formatCombatEngineOutcome(
      { actor_id: 'rook', action_type: 'cast_spell', target_ids: ['goblin-1', 'goblin-2'] },
      {
        results: [
          areaSaveResult({}),
          areaSaveResult({
            saveRoll: 17,
            totalAttackRoll: 17,
            hit: false,
            saved: true,
            finalDamage: 3,
            damage: 3,
            targetNewHp: 12,
            targetCondition: 'wounded',
          }),
        ],
      },
      areaRoster,
    );

    expect(line).toBe(
      '⚙️ Engine: Rook cast Burning Hands at Goblin Archer — DEX save 6 vs DC 13 — FAIL. ' +
        '7 fire damage. Goblin Archer is now at 4 HP.\n\n' +
        '⚙️ Engine: Rook cast Burning Hands at Goblin Boss — DEX save 17 vs DC 13 — PASS. ' +
        '3 fire damage. Goblin Boss is now at 12 HP.',
    );
  });

  it('words a healing result as a heal, not a hit for 0 damage', () => {
    // Follows the `healing` branch of `CombatAttackService`: no damage type, no spell name.
    const line = formatCombatEngineOutcome(
      { actor_id: 'rook', action_type: 'cast_spell', target_ids: ['goblin-1'] },
      {
        results: [
          {
            hit: true,
            targetAC: 0,
            totalAttackRoll: 0,
            finalDamage: 0,
            targetNewHp: 9,
            targetIsConscious: true,
            targetIsDead: false,
            effectiveResistance: false,
            effectiveVulnerability: false,
            effectiveImmunity: false,
            isCritical: false,
            isNaturalOne: false,
            isNaturalTwenty: false,
          },
        ],
      },
      areaRoster,
    );

    expect(line).toBe(
      '⚙️ Engine: Rook cast a healing spell at Goblin Archer — HEALS. Goblin Archer is now at 9 HP.',
    );
  });

  it('renders a refused spell with no roll, damage, or wound', () => {
    expect(formatRefusedSpellOutcome('Rook', 'Meteor Swarm', 'unknown spell')).toBe(
      '⚙️ Engine: Rook\'s spell "Meteor Swarm" was refused (unknown spell). No roll, no damage, no wound.',
    );
  });

  describe('HP left when an NPC hits the player (#2378)', () => {
    const npcSwing = {
      actor_id: 'emil-1',
      action_type: 'attack',
      target_ids: ['scholar-1'],
    };
    const hit = {
      actorName: 'Professor Emil Darkwater',
      targetName: 'The Scholar',
      d20: 14,
      attackBonus: 3,
      totalAttackRoll: 17,
      targetAC: 11,
      hit: true,
      finalDamage: 6,
      damageType: 'bludgeoning',
      targetNewHp: 1,
      targetCondition: 'near death' as const,
      weaponResolution: { resolved: 'Quarterstaff', substituted: false },
    };

    it('prints attacker, roll vs AC, damage and the HP the player has left', () => {
      const line = formatCombatEngineOutcome(npcSwing, hit, [], { targetHp: true });

      expect(line).toBe(
        '⚙️ Engine: Professor Emil Darkwater rolled 14 + 3 = 17 vs AC 11 against The Scholar with Quarterstaff — HIT. 6 bludgeoning damage. The Scholar is now at 1 HP and is near death.',
      );
    });

    it('names the state at 0 HP and prints nothing extra on a miss', () => {
      expect(
        formatCombatEngineOutcome(
          npcSwing,
          { ...hit, targetNewHp: 0, targetIsConscious: false },
          [],
          { targetHp: true },
        ),
      ).toContain('The Scholar is now at 0 HP and is unconscious.');
      expect(
        formatCombatEngineOutcome(
          npcSwing,
          { ...hit, hit: false, finalDamage: 0, targetNewHp: undefined },
          [],
          { targetHp: true },
        ),
      ).toContain('MISS. No damage.');
    });

    it('leaves numeric HP out when the target is not the player', () => {
      const line = formatCombatEngineOutcome(npcSwing, hit);

      expect(line).not.toContain('1 HP');
      expect(line).toContain('The Scholar is near death.');
    });

    it('returns an NPC turn as its engine line followed by the server lines', () => {
      const row = buildNpcEngineMessage([
        { id: npcSwing.actor_id, name: 'Captain Sarah Reeves', participantType: 'monster' },
        { id: npcSwing.target_ids[0], name: 'The Scholar', participantType: 'player' },
      ], 1, { type: 'attack', actorId: npcSwing.actor_id, targetId: npcSwing.target_ids[0] },
      { ...hit, deathSaves: [{ ...DEATH_SAVE_FAILED, participantId: npcSwing.target_ids[0] }] });
      expect(row.context.combatEngineBlocks[0].lines).toEqual([
        expect.stringContaining('now at 1 HP'),
        '⚙️ Engine: The Scholar rolled 6 on their death saving throw — FAILURE (0 successes, 2 failures).',
      ]);
    });
  });
});

describe('why a hit is critical (#2640)', () => {
  const roll = {
    actorName: 'Silent Monk',
    targetName: 'The Veteran',
    attackBonus: 3,
    targetAC: 18,
    hit: true,
    isCritical: true,
    finalDamage: 12,
    damageType: 'force',
  };

  it('an automatic critical on an unconscious target says so', () => {
    const line = formatCombatEngineOutcome(attack, {
      ...roll,
      d20: 18,
      totalAttackRoll: 21,
      autoCritReason: 'unconscious',
    });
    expect(line).toContain('— CRITICAL HIT (the target is unconscious).');
  });

  it('a paralyzed target is named as the reason too', () => {
    const line = formatCombatEngineOutcome(attack, {
      ...roll,
      d20: 9,
      totalAttackRoll: 12,
      autoCritReason: 'paralyzed',
    });
    expect(line).toContain('— CRITICAL HIT (the target is paralyzed).');
  });

  it('a natural 20 keeps the plain wording', () => {
    const line = formatCombatEngineOutcome(attack, { ...roll, d20: 20, totalAttackRoll: 23 });
    expect(line).toContain('— CRITICAL HIT.');
    expect(line).not.toContain('the target is');
  });
});
