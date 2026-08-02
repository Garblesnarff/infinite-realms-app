import { describe, it, expect } from 'vitest';

import { detectCombatActions, extractAction, detectPlayerCombatAction } from '../actions';

describe('combat detection actions', () => {
  describe('detectCombatActions', () => {
    it('should detect attack actions', () => {
      const text = 'The goblin attacks with a sword';
      const result = detectCombatActions(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        actor: 'Goblin',
        action: 'attack',
        target: '',
        weapon: 'sword',
        rollNeeded: true,
        rollType: 'attack',
      });
    });

    it('should detect spellcasting actions', () => {
      const text = 'The cultist casts fireball';
      const result = detectCombatActions(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        actor: 'Cultist',
        action: 'spell',
        target: '',
        weapon: '',
        rollNeeded: true,
        rollType: 'save',
      });
    });

    it('should detect damage actions', () => {
      const text = 'You take 10 damage from the mech';
      const result = detectCombatActions(text);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        actor: 'Mech',
        action: 'damage',
        target: '',
        weapon: '',
        rollNeeded: false,
        rollType: 'damage',
      });
    });

    it('should handle multiple sentences with different actions', () => {
      const text = 'The skeleton swings its weapon. The cultist casts a spell. You take 5 HP damage.';
      const result = detectCombatActions(text);
      expect(result).toHaveLength(3);
      expect(result[0].action).toBe('attack');
      expect(result[0].actor).toBe('Skeleton');
      expect(result[1].action).toBe('spell');
      expect(result[1].actor).toBe('Cultist');
      expect(result[2].action).toBe('damage');
      expect(result[2].actor).toBe('Unknown');
    });

    it('should return empty array when no keywords match', () => {
      const text = 'You walk down the quiet alley. The sun shines brightly.';
      const result = detectCombatActions(text);
      expect(result).toEqual([]);
    });
  });

  describe('extractAction', () => {
    it('should extract action with known enemy actor and weapon', () => {
      const sentence = 'A fierce dragon lunges with a sharp claw';
      const action = extractAction(sentence, 'attack');
      expect(action).toEqual({
        actor: 'Dragon',
        action: 'attack',
        target: '',
        weapon: 'claw',
        rollNeeded: true,
        rollType: 'attack',
      });
    });

    it('should default actor to Unknown when no enemies are found', () => {
      const sentence = 'A shadow strikes from the darkness';
      const action = extractAction(sentence, 'attack');
      expect(action?.actor).toBe('Unknown');
    });

    it('should extract correct weapons based on sentence content', () => {
      const weapons = ['sword', 'crossbow', 'bow', 'dagger', 'mace', 'weapon', 'claw', 'bite'];
      for (const weapon of weapons) {
        const sentence = `The warrior swings a ${weapon}`;
        const action = extractAction(sentence, 'attack');
        expect(action?.weapon).toBe(weapon);
      }
    });

    it('should set rollType to save for spells', () => {
      const sentence = 'The guard casts a spell';
      const action = extractAction(sentence, 'spell');
      expect(action).toMatchObject({
        rollNeeded: true,
        rollType: 'save',
      });
    });

    it('should set rollNeeded to false and rollType to damage for damage actions', () => {
      const sentence = 'The robot deals damage';
      const action = extractAction(sentence, 'damage');
      expect(action).toMatchObject({
        rollNeeded: false,
        rollType: 'damage',
      });
    });
  });

  describe('detectPlayerCombatAction', () => {
    it('should detect defense actions and prioritize them', () => {
      // Testing prioritization of defense keywords
      const inputs = [
        'I dodge the attack',
        'I defend against the blow',
        'I block with my shield',
      ];
      for (const input of inputs) {
        const action = detectPlayerCombatAction(input);
        expect(action).toEqual({
          actor: 'Player',
          action: 'defend',
          rollNeeded: false,
          rollType: 'skill',
        });
      }
    });

    it('should detect attack actions', () => {
      const inputs = [
        'I attack the goblin',
        'I hit the skeleton with my mace',
        'I shoot my crossbow',
      ];
      for (const input of inputs) {
        const action = detectPlayerCombatAction(input);
        expect(action).toEqual({
          actor: 'Player',
          action: 'attack',
          rollNeeded: true,
          rollType: 'attack',
        });
      }
    });

    it('should detect spellcasting actions', () => {
      const inputs = [
        'I cast magic missile',
        'I cast a spell',
      ];
      for (const input of inputs) {
        const action = detectPlayerCombatAction(input);
        expect(action).toEqual({
          actor: 'Player',
          action: 'cast spell',
          rollNeeded: true,
          rollType: 'attack',
        });
      }
    });

    it('should return null for non-combat inputs', () => {
      const inputs = [
        'I look around the room',
        'I talk to the merchant',
        'I open the heavy iron door',
      ];
      for (const input of inputs) {
        const action = detectPlayerCombatAction(input);
        expect(action).toBeNull();
      }
    });
  });
});
