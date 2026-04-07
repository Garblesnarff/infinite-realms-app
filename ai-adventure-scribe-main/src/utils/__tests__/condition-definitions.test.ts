/* eslint-disable max-lines */
import { describe, it, expect } from 'vitest';

import { CONDITION_EFFECTS } from '../condition-definitions';

import type { CombatParticipant, Condition } from '@/types/combat';

describe('CONDITION_EFFECTS', () => {
  const mockParticipant: CombatParticipant = {
    id: 'p1',
    name: 'Test Participant',
    participantType: 'monster',
    maxHitPoints: 50,
    currentHitPoints: 50,
    initiative: 10,
    conditions: [],
    speed: 30,
    movementUsed: 0,
    actionTaken: false,
    bonusActionTaken: false,
    reactionTaken: false,
  };

  describe('blinded', () => {
    const blinded = CONDITION_EFFECTS.blinded;

    it('gives disadvantage on attacks', () => {
      expect(blinded.getModifiers(mockParticipant, 'attack').disadvantage).toBe(true);
      expect(blinded.getModifiers(mockParticipant, 'melee_attack').disadvantage).toBe(true);
      expect(blinded.getModifiers(mockParticipant, 'ranged_attack').disadvantage).toBe(true);
    });

    it('gives advantage on defense (being attacked)', () => {
      const modifiers = blinded.getModifiers(mockParticipant, 'defense');
      expect(modifiers.advantage).toBe(true);
      expect(modifiers.description).toContain('Blind');
    });

    it('returns default for other roll types', () => {
      const modifiers = blinded.getModifiers(mockParticipant, 'save');
      expect(modifiers.advantage).toBe(false);
      expect(modifiers.disadvantage).toBe(false);
    });
  });

  describe('charmed', () => {
    const charmed = CONDITION_EFFECTS.charmed;

    it('auto-fails attacks against players', () => {
      const target: CombatParticipant = { ...mockParticipant, participantType: 'player' };
      const modifiers = charmed.getModifiers(mockParticipant, 'attack', target);
      expect(modifiers.autoFail).toBe(true);
      expect(modifiers.description).toContain('Charmed');
    });

    it('does not auto-fail attacks against non-players', () => {
      const target: CombatParticipant = { ...mockParticipant, participantType: 'monster' };
      const modifiers = charmed.getModifiers(mockParticipant, 'attack', target);
      expect(modifiers.autoFail).toBe(false);
    });

    it('returns empty for non-attack rolls', () => {
      expect(charmed.getModifiers(mockParticipant, 'save').description).toBe('');
    });
  });

  describe('deafened', () => {
    const deafened = CONDITION_EFFECTS.deafened;

    it('auto-fails hearing dependent saves', () => {
      const modifiers = deafened.getModifiers(mockParticipant, 'hearing_dependent');
      expect(modifiers.autoFail).toBe(true);
    });

    it('does not auto-fail other rolls', () => {
      const modifiers = deafened.getModifiers(mockParticipant, 'attack');
      expect(modifiers.autoFail).toBe(false);
    });
  });

  describe('frightened', () => {
    const frightened = CONDITION_EFFECTS.frightened;

    it('gives disadvantage on attacks', () => {
      const modifiers = frightened.getModifiers(mockParticipant, 'attack');
      expect(modifiers.disadvantage).toBe(true);
    });

    it('returns empty for non-attack rolls', () => {
      expect(frightened.getModifiers(mockParticipant, 'save').description).toBe('');
    });
  });

  describe('grappled', () => {
    const grappled = CONDITION_EFFECTS.grappled;

    it('provides default modifiers', () => {
      const modifiers = grappled.getModifiers(mockParticipant, 'attack');
      expect(modifiers.description).toContain('Grappled');
    });

    it('onApply sets movementUsed to speed', () => {
      const condition: Condition = { name: 'grappled', duration: -1 };
      const updated = grappled.onApply!(mockParticipant, condition);
      expect(updated.movementUsed).toBe(mockParticipant.speed);
      expect(updated.conditions).toContain(condition);
    });
  });

  describe('incapacitated', () => {
    const incapacitated = CONDITION_EFFECTS.incapacitated;

    it('auto-fails actions', () => {
      const modifiers = incapacitated.getModifiers(mockParticipant, 'action');
      expect(modifiers.autoFail).toBe(true);
    });

    it('returns incapacitated description', () => {
      expect(incapacitated.getModifiers(mockParticipant, 'action').description).toContain('Incapacitated');
    });
  });

  describe('invisible', () => {
    const invisible = CONDITION_EFFECTS.invisible;

    it('gives advantage on attacks', () => {
      const modifiers = invisible.getModifiers(mockParticipant, 'attack');
      expect(modifiers.advantage).toBe(true);
    });

    it('gives disadvantage to attackers (defense)', () => {
      const modifiers = invisible.getModifiers(mockParticipant, 'defense');
      expect(modifiers.disadvantage).toBe(true);
    });

    it('returns empty for other rolls', () => {
      expect(invisible.getModifiers(mockParticipant, 'save').description).toBe('');
    });
  });

  describe('paralyzed', () => {
    const paralyzed = CONDITION_EFFECTS.paralyzed;

    it('auto-fails DEX and STR saves', () => {
      expect(paralyzed.getModifiers(mockParticipant, 'dexterity_save').autoFail).toBe(true);
      expect(paralyzed.getModifiers(mockParticipant, 'strength_save').autoFail).toBe(true);
    });

    it('does not auto-fail other saves', () => {
      expect(paralyzed.getModifiers(mockParticipant, 'wisdom_save').autoFail).toBe(false);
    });
  });

  describe('petrified', () => {
    const petrified = CONDITION_EFFECTS.petrified;

    it('auto-fails rolls', () => {
      const modifiers = petrified.getModifiers(mockParticipant, 'attack');
      expect(modifiers.autoFail).toBe(true);
    });

    it('returns petrified description', () => {
      const modifiers = petrified.getModifiers(mockParticipant, 'attack');
      expect(modifiers.description).toContain('Petrified');
    });
  });

  describe('poisoned', () => {
    const poisoned = CONDITION_EFFECTS.poisoned;

    it('gives disadvantage on attacks and ability checks', () => {
      expect(poisoned.getModifiers(mockParticipant, 'attack').disadvantage).toBe(true);
      expect(poisoned.getModifiers(mockParticipant, 'ability_check').disadvantage).toBe(true);
    });

    it('returns empty for other rolls', () => {
      expect(poisoned.getModifiers(mockParticipant, 'save').description).toBe('');
    });
  });

  describe('prone', () => {
    const prone = CONDITION_EFFECTS.prone;

    it('gives advantage on melee attacks against target', () => {
      const target: CombatParticipant = { ...mockParticipant };
      const modifiers = prone.getModifiers(mockParticipant, 'melee_attack', target);
      expect(modifiers.advantage).toBe(true);
    });

    it('gives disadvantage on ranged attacks', () => {
      const modifiers = prone.getModifiers(mockParticipant, 'ranged_attack');
      expect(modifiers.disadvantage).toBe(true);
    });

    it('returns empty for other rolls', () => {
      expect(prone.getModifiers(mockParticipant, 'attack').description).toBe('');
    });
  });

  describe('restrained', () => {
    const restrained = CONDITION_EFFECTS.restrained;

    it('gives disadvantage on defense', () => {
      const modifiers = restrained.getModifiers(mockParticipant, 'defense');
      expect(modifiers.disadvantage).toBe(true);
    });

    it('auto-fails DEX saves', () => {
      const modifiers = restrained.getModifiers(mockParticipant, 'dexterity_save');
      expect(modifiers.autoFail).toBe(true);
    });

    it('returns empty for other rolls', () => {
      const modifiers = restrained.getModifiers(mockParticipant, 'attack');
      expect(modifiers.description).toBe('');
    });

    it('onApply sets movementUsed to speed', () => {
      const condition: Condition = { name: 'restrained', duration: -1 };
      const updated = restrained.onApply!(mockParticipant, condition);
      expect(updated.movementUsed).toBe(mockParticipant.speed);
    });
  });

  describe('stunned', () => {
    const stunned = CONDITION_EFFECTS.stunned;

    it('auto-fails DEX and STR saves', () => {
      expect(stunned.getModifiers(mockParticipant, 'dexterity_save').autoFail).toBe(true);
      expect(stunned.getModifiers(mockParticipant, 'strength_save').autoFail).toBe(true);
    });
  });

  describe('unconscious', () => {
    const unconscious = CONDITION_EFFECTS.unconscious;

    it('auto-fails actions', () => {
      const modifiers = unconscious.getModifiers(mockParticipant, 'action');
      expect(modifiers.autoFail).toBe(true);
    });

    it('gives disadvantage on defense', () => {
      const modifiers = unconscious.getModifiers(mockParticipant, 'defense');
      expect(modifiers.disadvantage).toBe(true);
    });

    it('auto-fails other rolls (like saves or actions)', () => {
      expect(unconscious.getModifiers(mockParticipant, 'save').autoFail).toBe(true);
      expect(unconscious.getModifiers(mockParticipant, 'action').autoFail).toBe(true);
    });
  });

  describe('exhaustion', () => {
    const exhaustion = CONDITION_EFFECTS.exhaustion;

    it('level 1 gives disadvantage on ability checks', () => {
      const participant: CombatParticipant = {
        ...mockParticipant,
        conditions: [{ name: 'exhaustion', level: 1, duration: -1 }],
      };
      const modifiers = exhaustion.getModifiers(participant, 'ability_check');
      expect(modifiers.disadvantage).toBe(true);
    });

    it('level 2 gives disadvantage on ability checks but not attacks', () => {
      const participant: CombatParticipant = {
        ...mockParticipant,
        conditions: [{ name: 'exhaustion', level: 2, duration: -1 }],
      };
      expect(exhaustion.getModifiers(participant, 'ability_check').disadvantage).toBe(true);
      expect(exhaustion.getModifiers(participant, 'attack').disadvantage).toBe(false);
    });

    it('level 3 gives disadvantage on attacks and saves', () => {
      const participant: CombatParticipant = {
        ...mockParticipant,
        conditions: [{ name: 'exhaustion', level: 3, duration: -1 }],
      };
      expect(exhaustion.getModifiers(participant, 'attack').disadvantage).toBe(true);
      expect(exhaustion.getModifiers(participant, 'save').disadvantage).toBe(true);
    });

    it('returns empty modifiers when exhaustion level is 0', () => {
      const participant: CombatParticipant = {
        ...mockParticipant,
        conditions: [{ name: 'exhaustion', level: 0, duration: -1 }],
      };
      const modifiers = exhaustion.getModifiers(participant, 'attack');
      expect(modifiers.disadvantage).toBe(false);
    });

    it('returns empty modifiers when exhaustion condition is not present', () => {
      const modifiers = exhaustion.getModifiers(mockParticipant, 'attack');
      expect(modifiers.disadvantage).toBe(false);
    });
  });

  describe('surprised', () => {
    const surprised = CONDITION_EFFECTS.surprised;

    it('returns default modifiers', () => {
      const modifiers = surprised.getModifiers(mockParticipant, 'attack');
      expect(modifiers.advantage).toBe(false);
      expect(modifiers.disadvantage).toBe(false);
      expect(modifiers.autoFail).toBe(false);
    });
  });
});
