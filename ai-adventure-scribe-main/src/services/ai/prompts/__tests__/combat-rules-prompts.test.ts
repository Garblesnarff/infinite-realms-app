import { describe, it, expect } from 'vitest';

import { CombatRulesPrompts } from '../combat-rules-prompts';

import type { CombatDetectionResult } from '@/utils/combatDetection';

describe('CombatRulesPrompts', () => {
  describe('buildCombatRulesSection', () => {
    it('should return a string containing key combat instructions', () => {
      const section = CombatRulesPrompts.buildCombatRulesSection();

      expect(section).toContain('<combat>');
      expect(section).toContain('COMBAT GUIDELINES');
      expect(section).toContain('COMBAT TURN ORDER');
      expect(section).toContain('DEATH SAVING THROWS (0 HP)');
      expect(section).toContain('HEALING AND RECOVERY');
      expect(section).toContain('TEMPORARY HIT POINTS');
      expect(section).toContain('ADVANTAGE AND DISADVANTAGE');
      expect(section).toContain('CRITICAL HITS AND FUMBLES');
      expect(section).toContain('COMBAT CONDITIONS AND STATUS EFFECTS');
      expect(section).toContain('ACTION ECONOMY IN COMBAT');
      expect(section).toContain('</combat>');
    });
  });

  describe('buildEncounterDifficultySection', () => {
    it('should return scaled difficulty guides by character level', () => {
      const section = CombatRulesPrompts.buildEncounterDifficultySection();

      expect(section).toContain('<encounter_difficulty>');
      expect(section).toContain('ENCOUNTER SCALING BY CHARACTER LEVEL');
      expect(section).toContain('Character Level 1-2');
      expect(section).toContain('Character Level 3-4');
      expect(section).toContain('Character Level 5-8');
      expect(section).toContain('Character Level 9+');
      expect(section).toContain('</encounter_difficulty>');
    });
  });

  describe('buildCombatRollRequirementsSection', () => {
    it('should return dice roll formats and examples', () => {
      const section = CombatRulesPrompts.buildCombatRollRequirementsSection();

      expect(section).toContain('<combat_roll_requirements>');
      // The section now teaches the structured `roll_requests` array; the old
      // ROLL_REQUESTS_V1 text marker was removed from the prompt itself.
      expect(section).toContain('`roll_requests` array field');
      expect(section).toContain('"type": "attack"');
      expect(section).toContain('</combat_roll_requirements>');
    });
  });

  describe('buildSpatialTurnContractSection', () => {
    it('states the reach rule and shows a move-and-attack turn', () => {
      const section = CombatRulesPrompts.buildSpatialTurnContractSection();

      expect(section).toContain('<spatial_turn_contract>');
      expect(section).toContain('within\n5ft of its target');
      expect(section).toContain('movementRemaining');
      expect(section).toContain('line of sight');
      // The worked example must show both halves of one turn.
      expect(section).toContain('"action":"move","entityId":"shadow-roach-1"');
      expect(section).toContain('"action_type":"attack","target_ids":["the-seeker"]');
      expect(section).toContain('</spatial_turn_contract>');
      // Every id in the example is a token the digest actually renders, and the rule that
      // makes that matter is stated outright.
      expect(section).toContain('copied verbatim from the tactical digest');
      expect(section).toContain('shadow-roach-1|Shadow Roach@12,10');
      expect(section).toContain('the-seeker|The Seeker@1,1');
      expect(section).not.toMatch(/entityId":"[0-9a-f]{8}-/);
    });
  });

  describe('formatCombatContext', () => {
    it('should return empty string if isCombat is false', () => {
      const emptyContext: CombatDetectionResult = {
        isCombat: false,
        combatType: 'none',
        confidence: 0,
        shouldStartCombat: false,
        shouldEndCombat: false,
      };

      const result = CombatRulesPrompts.formatCombatContext(emptyContext);
      expect(result).toBe('');
    });

    it('should return correct base structure when isCombat is true but enemies and actions are empty', () => {
      const minimalContext: CombatDetectionResult = {
        isCombat: true,
        combatType: 'melee',
        confidence: 0.85,
        shouldStartCombat: true,
        shouldEndCombat: false,
        enemies: [],
        combatActions: [],
      };

      const result = CombatRulesPrompts.formatCombatContext(minimalContext);

      expect(result).toContain('COMBAT CONTEXT DETECTED:');
      expect(result).toContain('Combat Type: melee');
      expect(result).toContain('Confidence: 85%');
      expect(result).toContain('Should Start Combat: YES');
      expect(result).toContain('Should End Combat: NO');
      expect(result).not.toContain('DETECTED ENEMIES:');
      expect(result).not.toContain('DETECTED COMBAT ACTIONS:');
      expect(result).toContain('COMBAT RESPONSE REQUIREMENTS:');
    });

    it('should format detected enemies list with details when present', () => {
      const enemyContext: CombatDetectionResult = {
        isCombat: true,
        combatType: 'ranged',
        confidence: 0.9,
        shouldStartCombat: false,
        shouldEndCombat: false,
        enemies: [
          {
            name: 'Goblin 1',
            type: 'creature',
            estimatedCR: '1/4',
            suggestedHP: 7,
            suggestedAC: 15,
            description: 'A sneaky goblin with a shortbow.',
          },
          {
            name: 'Orc Boss',
            type: 'humanoid',
            estimatedCR: 2,
            suggestedHP: 45,
            suggestedAC: 16,
            description: 'A muscular orc wielding a greataxe.',
          },
        ],
      };

      const result = CombatRulesPrompts.formatCombatContext(enemyContext);

      expect(result).toContain('DETECTED ENEMIES:');
      expect(result).toContain('- Goblin 1 (creature, CR 1/4)');
      expect(result).toContain('HP: 7, AC: 15');
      expect(result).toContain('Description: A sneaky goblin with a shortbow.');

      expect(result).toContain('- Orc Boss (humanoid, CR 2)');
      expect(result).toContain('HP: 45, AC: 16');
      expect(result).toContain('Description: A muscular orc wielding a greataxe.');
    });

    it('should format detected combat actions with all fields present', () => {
      const actionContext: CombatDetectionResult = {
        isCombat: true,
        combatType: 'skirmish',
        confidence: 0.95,
        shouldStartCombat: false,
        shouldEndCombat: false,
        combatActions: [
          {
            actor: 'Grog',
            action: 'attacks',
            target: 'Orc Boss',
            weapon: 'Greatsword',
            rollType: 'attack',
            rollNeeded: true,
          },
        ],
      };

      const result = CombatRulesPrompts.formatCombatContext(actionContext);

      expect(result).toContain('DETECTED COMBAT ACTIONS:');
      expect(result).toContain('- Grog performs attacks against Orc Boss with Greatsword');
      expect(result).toContain('Roll Type: attack, Needs Roll: YES');
    });

    it('should handle optional target and weapon missing from combat actions', () => {
      const actionContext: CombatDetectionResult = {
        isCombat: true,
        combatType: 'skirmish',
        confidence: 0.95,
        shouldStartCombat: false,
        shouldEndCombat: false,
        combatActions: [
          {
            actor: 'Wizard',
            action: 'casts Shield',
            rollType: 'defense',
            rollNeeded: false,
          },
        ],
      };

      const result = CombatRulesPrompts.formatCombatContext(actionContext);

      expect(result).toContain('DETECTED COMBAT ACTIONS:');
      const actionLine = result.split('\n').find((line) => line.includes('- Wizard'));
      expect(actionLine).toBeDefined();
      expect(actionLine).toContain('- Wizard performs casts Shield');
      expect(actionLine).not.toContain('against');
      expect(actionLine).not.toContain('with');
      expect(result).toContain('Roll Type: defense, Needs Roll: NO');
    });
  });
});
