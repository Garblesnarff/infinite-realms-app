/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect } from 'vitest';

import {
  detectCombatFromText,
  detectPlayerCombatAction,
  createCombatParticipantsFromDetection,
  shouldEndCombat,
  getDiceRollRequirements,
} from '../combatDetection';

describe('combatDetection', () => {
  describe('detectCombatFromText', () => {
    it('should detect combat when initiative is mentioned', () => {
      const text = "The goblins draw their scimitars. Roll initiative!";
      const result = detectCombatFromText(text);

      expect(result.isCombat).toBe(true);
      expect(result.combatType).toBe('initiative');
      expect(result.shouldStartCombat).toBe(true);
      expect(result.confidence).toBeGreaterThanOrEqual(0.9);
      expect(result.enemies).toBeDefined();
      expect(result.enemies![0].name).toBe('Goblin');
    });

    it('should detect combat when an attack is described', () => {
      const text = "An orc lunges at you with a jagged axe.";
      const result = detectCombatFromText(text);

      expect(result.isCombat).toBe(true);
      expect(result.combatType).toBe('attack');
      expect(result.shouldStartCombat).toBe(false); // Only initiative starts combat
      expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('should detect spell casting as combat', () => {
      const text = "The cultist casts a fireball into the room!";
      const result = detectCombatFromText(text);

      expect(result.isCombat).toBe(true);
      expect(result.combatType).toBe('spell_cast');
    });

    it('should detect damage as combat', () => {
      const text = "You take 10 damage from the trap.";
      const result = detectCombatFromText(text);

      expect(result.isCombat).toBe(true);
      expect(result.combatType).toBe('damage_taken');
    });

    it('should correctly identify enemies and use templates', () => {
      const text = "A dragon and a mech appear!";
      const result = detectCombatFromText(text);

      expect(result.enemies).toHaveLength(2);

      const dragon = result.enemies?.find(e => e.type === 'dragon');
      expect(dragon?.suggestedHP).toBe(200);
      expect(dragon?.suggestedAC).toBe(18);

      const mech = result.enemies?.find(e => e.type === 'mech');
      expect(mech?.suggestedHP).toBe(45);
      expect(mech?.suggestedAC).toBe(16);
    });

    it('should detect combat ending', () => {
      const text = "The last enemy falls. Combat ends!";
      const result = detectCombatFromText(text);

      expect(result.shouldEndCombat).toBe(true);
      expect(result.shouldStartCombat).toBe(false);
    });

    it('should handle stealth cues by lowering confidence', () => {
      const text = "You see a goblin, but you stay in the shadows and stealthily move past.";
      const result = detectCombatFromText(text);

      // confidence should be lowered because of stealth cues and no direct combat cue
      expect(result.isCombat).toBe(false);
      expect(result.confidence).toBeLessThan(0.5);
    });

    it('should still start combat if initiative is mentioned despite stealth cues', () => {
      const text = "You try to stealth, but you are spotted! Roll initiative!";
      const result = detectCombatFromText(text);

      expect(result.isCombat).toBe(true);
      expect(result.shouldStartCombat).toBe(true);
    });
  });

  describe('detectPlayerCombatAction', () => {
    it('should detect an attack action from player input', () => {
      const input = "I attack the goblin with my sword";
      const result = detectPlayerCombatAction(input);

      expect(result).toBeDefined();
      expect(result).not.toBeNull();
      expect(result?.action).toBe('attack');
      expect(result?.rollType).toBe('attack');
      expect(result?.rollNeeded).toBe(true);
    });

    it('should detect a spell cast from player input', () => {
      const input = "I cast magic missile";
      const result = detectPlayerCombatAction(input);

      expect(result).not.toBeNull();
      expect(result?.action).toBe('cast spell');
      expect(result?.rollType).toBe('attack');
    });

    it('should detect defense actions', () => {
      const input = "I dodge the incoming blast";
      const result = detectPlayerCombatAction(input);

      expect(result).not.toBeNull();
      expect(result?.action).toBe('defend');
      expect(result?.rollNeeded).toBe(false);
    });

    it('should return null for non-combat input', () => {
      const input = "I look around the room";
      const result = detectPlayerCombatAction(input);

      expect(result).toBeNull();
    });
  });

  describe('createCombatParticipantsFromDetection', () => {
    it('should create participants for both player and enemies', () => {
      const enemies = [
        {
          name: 'Goblin',
          type: 'humanoid' as any,
          estimatedCR: '1/4',
          description: '',
          suggestedHP: 7,
          suggestedAC: 15
        }
      ];

      const player = {
        id: 'char-123',
        name: 'Aragorn',
        armor_class: 16,
        hit_points: 20,
        abilityScores: {
          dexterity: { modifier: 3 }
        }
      };

      const participants = createCombatParticipantsFromDetection(enemies, player);

      expect(participants).toHaveLength(2);

      const playerPart = participants.find(p => p.participantType === 'player');
      expect(playerPart?.name).toBe('Aragorn');
      expect(playerPart?.initiative).toBe(3);
      expect(playerPart?.armorClass).toBe(16);

      const enemyPart = participants.find(p => p.participantType === 'monster');
      expect(enemyPart?.name).toBe('Goblin');
      expect(enemyPart?.maxHitPoints).toBe(7);
      expect(enemyPart?.initiative).toBe(1); // Estimated from CR 1/4
    });

    it('should handle missing player character', () => {
      const enemies = [
        {
          name: 'Orc',
          type: 'humanoid' as any,
          estimatedCR: '1/2',
          description: '',
          suggestedHP: 15,
          suggestedAC: 13
        }
      ];

      const participants = createCombatParticipantsFromDetection(enemies, null);

      expect(participants).toHaveLength(1);
      expect(participants[0].participantType).toBe('monster');
    });
  });

  describe('shouldEndCombat', () => {
    it('should return true for combat ending phrases', () => {
      expect(shouldEndCombat("The battle is over")).toBe(true);
      expect(shouldEndCombat("enemies defeated")).toBe(true);
    });

    it('should return false for other phrases', () => {
      expect(shouldEndCombat("The battle continues")).toBe(false);
    });
  });

  describe('getDiceRollRequirements', () => {
    it('should aggregate roll requirements correctly', () => {
      const actions = [
        {
          actor: 'Goblin',
          action: 'attack',
          rollNeeded: true,
          rollType: 'attack' as any
        },
        {
          actor: 'Cultist',
          action: 'cast',
          rollNeeded: true,
          rollType: 'save' as any
        },
        {
          actor: 'DM',
          action: 'damage',
          rollNeeded: false,
          rollType: 'damage' as any
        }
      ];

      const result = getDiceRollRequirements(actions);

      expect(result.attackRolls).toBe(1);
      expect(result.damageRolls).toBe(1); // Attack often needs damage
      expect(result.savingThrows).toBe(1);
      expect(result.skillChecks).toBe(0);
    });
  });
});
