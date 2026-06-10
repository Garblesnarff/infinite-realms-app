
import { describe, it, expect } from 'vitest';

import { detectCombatActions, extractAction, detectPlayerCombatAction } from '../actions';

describe('combat detection actions', () => {
  describe('detectCombatActions', () => {
    it('should detect attack actions from narrative', () => {
      const text = 'The goblin attacks with a sword. It strikes quickly.';
      const actions = detectCombatActions(text);

      expect(actions).toHaveLength(2);
      expect(actions[0]).toMatchObject({
        actor: 'Goblin',
        action: 'attack',
        weapon: 'sword',
        rollType: 'attack',
        rollNeeded: true
      });
      expect(actions[1].action).toBe('attack');
    });

    it('should detect spell casting actions', () => {
      const text = 'The cultist casts a mysterious spell.';
      const actions = detectCombatActions(text);

      expect(actions).toHaveLength(1);
      expect(actions[0]).toMatchObject({
        action: 'spell',
        rollType: 'save',
        rollNeeded: true
      });
    });

    it('should detect damage dealing', () => {
      const text = 'The trap deals 10 damage. You lose hit points.';
      const actions = detectCombatActions(text);

      expect(actions).toHaveLength(2);
      expect(actions[0]).toMatchObject({
        action: 'damage',
        rollType: 'damage',
        rollNeeded: false
      });
    });

    it('should handle multiple sentences with mixed actions', () => {
      const text = 'An orc attacks! Then it casts a spell. Finally, you take damage.';
      const actions = detectCombatActions(text);

      expect(actions).toHaveLength(3);
      expect(actions[0].action).toBe('attack');
      expect(actions[1].action).toBe('spell');
      expect(actions[2].action).toBe('damage');
    });
  });

  describe('extractAction', () => {
    it('should identify known enemies as actors', () => {
      const action = extractAction('A dragon swings its tail', 'attack');
      expect(action?.actor).toBe('Dragon');
    });

    it('should identify known weapons', () => {
      const action = extractAction('He strikes with a mace', 'attack');
      expect(action?.weapon).toBe('mace');
    });

    it('should default to Unknown actor if no enemy keyword is found', () => {
      const action = extractAction('Something strikes from the shadows', 'attack');
      expect(action?.actor).toBe('Unknown');
    });

    it('should set correct roll types for different actions', () => {
      expect(extractAction('attack', 'attack')?.rollType).toBe('attack');
      expect(extractAction('cast', 'spell')?.rollType).toBe('save');
      expect(extractAction('damage', 'damage')?.rollType).toBe('damage');
    });
  });

  describe('detectPlayerCombatAction', () => {
    it('should detect attack actions', () => {
      expect(detectPlayerCombatAction('I attack the orc')).toMatchObject({
        actor: 'Player',
        action: 'attack',
        rollType: 'attack'
      });
      expect(detectPlayerCombatAction('I hit it')).toMatchObject({ action: 'attack' });
      expect(detectPlayerCombatAction('I shoot the bow')).toMatchObject({ action: 'attack' });
    });

    it('should detect spell casting', () => {
      expect(detectPlayerCombatAction('I cast fireball')).toMatchObject({
        actor: 'Player',
        action: 'cast spell',
        rollType: 'attack'
      });
      expect(detectPlayerCombatAction('I use a spell')).toMatchObject({ action: 'cast spell' });
    });

    it('should detect defense actions', () => {
      expect(detectPlayerCombatAction('I dodge')).toMatchObject({
        actor: 'Player',
        action: 'defend',
        rollNeeded: false,
        rollType: 'skill'
      });
      expect(detectPlayerCombatAction('I block the blow')).toMatchObject({ action: 'defend' });
      expect(detectPlayerCombatAction('I defend myself')).toMatchObject({ action: 'defend' });
    });

    it('should return null for non-combat actions', () => {
      expect(detectPlayerCombatAction('I talk to the guard')).toBeNull();
      expect(detectPlayerCombatAction('I look around')).toBeNull();
    });

    it('BUG: should prioritize defense over attack in "I dodge the attack"', () => {
      // This identifies a bug where "attack" keyword triggers before "dodge"
      const result = detectPlayerCombatAction('I dodge the attack');
      expect(result?.action).toBe('defend');
    });
  });
});
