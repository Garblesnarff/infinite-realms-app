import { describe, expect, it } from 'vitest';

import { buildNpcEngineMessage } from '../../../../shared/npc-engine-message';
import { DEATH_SAVE_FAILED } from '../../../../shared/test-fixtures/engine-results';
import {
  formatCombatActionParts,
  formatCombatEndLine,
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

  it('names both d20s and the kept one on disadvantage (#263 CB-028)', () => {
    const line = formatCombatEngineOutcome(attack, {
      actorName: 'The Seeker',
      targetName: 'Balthazar',
      d20: 8,
      d20Rolls: [8, 14],
      disadvantage: true,
      attackBonus: 4,
      totalAttackRoll: 12,
      targetAC: 12,
      hit: true,
      finalDamage: 3,
      damageType: 'slashing',
    });

    expect(line).toContain('rolled 8 and 14 (disadvantage, kept 8)');
    expect(line).toContain('12 vs AC 12');
  });

  it('names both d20s and the kept one on advantage (#263 CB-028)', () => {
    const line = formatCombatEngineOutcome(attack, {
      actorName: 'The Seeker',
      targetName: 'Balthazar',
      d20: 18,
      d20Rolls: [18, 7],
      advantage: true,
      attackBonus: 4,
      totalAttackRoll: 22,
      targetAC: 12,
      hit: true,
      finalDamage: 3,
      damageType: 'slashing',
    });

    expect(line).toContain('rolled 18 and 7 (advantage, kept 18)');
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
      '⚙️ Engine: Rook cast Magic Missile at Professor Umeboshi — AUTO-HIT. 8 force damage. Professor Umeboshi is dead.',
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
        '7 fire damage. Goblin Archer is bloodied.\n\n' +
        '⚙️ Engine: Rook cast Burning Hands at Goblin Boss — DEX save 17 vs DC 13 — PASS. ' +
        '3 fire damage. Goblin Boss is wounded.',
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

    expect(line).toBe('⚙️ Engine: Rook cast a healing spell at Goblin Archer — HEALS.');
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
      const row = buildNpcEngineMessage(
        [
          { id: npcSwing.actor_id, name: 'Captain Sarah Reeves', participantType: 'monster' },
          { id: npcSwing.target_ids[0], name: 'The Scholar', participantType: 'player' },
        ],
        1,
        { type: 'attack', actorId: npcSwing.actor_id, targetId: npcSwing.target_ids[0] },
        { ...hit, deathSaves: [{ ...DEATH_SAVE_FAILED, participantId: npcSwing.target_ids[0] }] },
      );
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

describe('fighter feature engine lines (#975)', () => {
  it('Second Wind names the healed amount and the new HP', () => {
    const parts = formatCombatActionParts(
      { actor_id: 'ghorza', action_type: 'second_wind', target_ids: [] },
      {
        applied: true,
        action: 'second_wind',
        roll: 7,
        healed: 8,
        newHp: 9,
        maxHp: 12,
        usesRemaining: 0,
      },
      [{ id: 'ghorza', name: 'Ghorza' }],
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].line).toContain('used Second Wind and regained 8 HP (HP 9/12)');
  });

  it('Action Surge names the additional action this turn', () => {
    const parts = formatCombatActionParts(
      { actor_id: 'ghorza', action_type: 'action_surge', target_ids: [] },
      { applied: true, action: 'action_surge', usesRemaining: 0, extraActionArmed: false },
      [{ id: 'ghorza', name: 'Ghorza' }],
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].line).toContain('used Action Surge — one additional action this turn');
  });

  it('Use item names the item, the healed amount, and the new HP (#1147)', () => {
    const parts = formatCombatActionParts(
      { actor_id: 'ghorza', action_type: 'use_item', target_ids: [] },
      {
        applied: true,
        action: 'use_item',
        itemName: 'Potion of Healing',
        itemId: 'potion-1',
        healed: 9,
        newHp: 18,
        maxHp: 20,
        remainingQuantity: 1,
        itemDeleted: false,
      },
      [{ id: 'ghorza', name: 'Ghorza' }],
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].line).toContain('used Potion of Healing and regained 9 HP (HP 18/20)');
  });
});
describe('combat end line player text (#976)', () => {
  // Every member of the CombatEndReason union (server-bun/src/types/combat.ts),
  // plus death_save_failed — a legacy formatter entry no current producer emits
  // (death-save endings conclude as party_defeated / player_down_stable), kept
  // covered so the map stays total. The internal key must never reach the player
  // line — it lives on the encounter row, in telemetry, and in the persisted
  // row's stored result.
  const reasons: Array<[string, string]> = [
    ['last_hostile_defeated', '⚙️ Engine: Combat ended — the last hostile was defeated.'],
    ['party_defeated', '⚙️ Engine: Combat ended — the party was defeated.'],
    ['death_save_failed', '⚙️ Engine: Combat ended — a death save ended the fight.'],
    ['player_down_stable', '⚙️ Engine: Combat ended — the party was knocked out but stable.'],
    ['dm_ended_scene', '⚙️ Engine: Combat ended — the fight ended as the scene moved on.'],
    ['ended_by_request', '⚙️ Engine: Combat ended — you ended the fight.'],
    ['abandoned', '⚙️ Engine: Combat ended — the party broke off and left the fight.'],
    ['player_surrendered', '⚙️ Engine: Combat ended — you yielded.'],
    ['ended_idle', '⚙️ Engine: Combat ended — the fight was left idle and closed.'],
  ];

  it.each(reasons)('renders %s as player text with no internal key', (reason, line) => {
    expect(formatCombatEndLine(reason)).toBe(line);
    expect(formatCombatEndLine(reason)).not.toContain('(reason:');
    expect(formatCombatEndLine(reason)).not.toContain(reason);
  });

  it('never prints an unmapped key', () => {
    expect(formatCombatEndLine('some_future_reason')).toBe(
      '⚙️ Engine: Combat ended — the fight is over.',
    );
  });

  it('returns null without a reason', () => {
    expect(formatCombatEndLine(null)).toBeNull();
    expect(formatCombatEndLine(undefined)).toBeNull();
    expect(formatCombatEndLine('')).toBeNull();
  });

  it('stamps combatEnded on the terminal engine row, and only there', () => {
    const participants = [
      { id: 'pc-1', name: 'Ghorza', participantType: 'player' },
      { id: 'm-1', name: "Remy 'The Manager'", participantType: 'monster' },
    ];
    const ended = buildNpcEngineMessage(
      participants,
      7,
      { type: 'attack', actorId: 'pc-1', targetIds: ['m-1'] },
      {
        actorName: 'Ghorza',
        targetName: "Remy 'The Manager'",
        hit: true,
        finalDamage: 9,
        targetNewHp: 0,
        targetIsConscious: false,
        combatEnded: true,
        endedReason: 'last_hostile_defeated',
      },
    );
    expect(ended.text).toContain('Combat ended — the last hostile was defeated.');
    expect(ended.context.combatEnded).toBe(true);

    const midFight = buildNpcEngineMessage(
      participants,
      7,
      { type: 'attack', actorId: 'pc-1', targetIds: ['m-1'] },
      {
        actorName: 'Ghorza',
        targetName: "Remy 'The Manager'",
        hit: true,
        finalDamage: 3,
        targetNewHp: 8,
        targetIsConscious: true,
      },
    );
    expect(midFight.context.combatEnded).toBeUndefined();
  });
});
