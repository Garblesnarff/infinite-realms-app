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
    /**
     * This assertion is the inverse of the one it replaces, deliberately.
     *
     * It used to demand that no attack example appear here, on run 8's reasoning that examples
     * beat instructions and the old examples taught the wrong channel. Run 9 emptied the
     * prompt of attack examples and the model stopped emitting structured attacks entirely —
     * twenty-three of them in pure prose across thirty turns. The example is the elicitation;
     * the server translates whichever channel arrives. So it is required here now.
     */
    it('teaches attacks, saves, and checks as one coherent roll_requests contract', () => {
      const section = CombatRulesPrompts.buildCombatRollRequirementsSection();

      expect(section).toContain('<combat_roll_requirements>');
      expect(section).toContain('`roll_requests` array');
      expect(section).toContain('"type": "save"');
      expect(section).toContain('"type": "check"');
      expect(section).toContain('"type": "attack"');
      // The example must be worked, not gestured at: a real purpose naming both digest ids.
      expect(section).toContain('"purpose": "the-seeker attacks shadow-roach-1 with longsword"');
      // ...and it must not reintroduce the contradiction it is replacing.
      expect(section).not.toMatch(/saving throws and ability checks ONLY/i);
      expect(section).toContain('INTENTIONAL_ELICITATION_DIALECT');
      expect(section).toContain('resolves each one');
      expect(section).toContain('</combat_roll_requirements>');
    });

    it('keeps combat_actions documented as an equally valid channel', () => {
      const section = CombatRulesPrompts.buildCombatRollRequirementsSection();
      expect(section).toContain('combat_actions');
      expect(section).toMatch(/resolved identically|Either channel works/);
    });

    it('names the failure the floor exists to catch: declaring nothing at all', () => {
      const section = CombatRulesPrompts.buildCombatRollRequirementsSection();
      expect(section).toMatch(/appears in neither array is an attack the engine never rolled/);
    });
  });

  describe('buildSpatialTurnContractSection', () => {
    it('tells the DM to declare attacks and let the engine handle approach', () => {
      const section = CombatRulesPrompts.buildSpatialTurnContractSection();

      expect(section).toContain('<spatial_turn_contract>');
      expect(section).toContain('`roll_requests` entry with `"type": "attack"`');
      expect(section).toContain('walks the attacker');
      // The old instruction — emit a move yourself before attacking — is what the model
      // ignored for thirty turns. It must not survive anywhere in this section.
      expect(section).not.toContain('you MUST emit a `map_actions` move');
      expect(section).toContain('Approach before a strike is the engine');
      expect(section).toContain('</spatial_turn_contract>');
    });

    /**
     * This section and <combat_roll_requirements> must teach the SAME channel. Run 8 spent
     * eleven correctives on a prompt where one block demanded `combat_actions` while another
     * still worked an example in `roll_requests`; the model followed the example. Their
     * agreement is the property under test, not the channel they happen to agree on.
     */
    it('is written in the same dialect the roll requirements block teaches', () => {
      const contract = CombatRulesPrompts.buildSpatialTurnContractSection();
      const requirements = CombatRulesPrompts.buildCombatRollRequirementsSection();
      for (const section of [contract, requirements]) {
        expect(section).toContain('INTENTIONAL_ELICITATION_DIALECT');
        expect(section).toContain('"type": "attack"');
        expect(section).not.toMatch(/Do NOT put attacks in `roll_requests`/i);
      }
    });

    it('works the three-roach example through both outcomes', () => {
      const section = CombatRulesPrompts.buildSpatialTurnContractSection();

      // Two monster attacks declared in one turn, against digest-real ids.
      expect(section).toContain('"purpose":"shadow-roach-1 attacks the-seeker"');
      expect(section).toContain('"purpose":"shadow-roach-2 attacks the-seeker"');
      expect(section).toContain('shadow-roach-1|Shadow Roach@6,5');
      expect(section).toContain('shadow-roach-2|Shadow Roach@10,9');
      // One auto-approach outcome and one out-of-reach-becomes-move outcome.
      expect(section).toContain('it closes to 5ft and its bite is rolled');
      expect(section).toContain('its action becomes');
      expect(section).toContain('could not\n  reach it');
      expect(section).toContain('NOT a bite that never happened');
      // Ambiguity is called out with the exact shape that misfired in run 7.
      expect(section).toContain('"the Shadow Roach" names none of them');
      expect(section).toContain('<engine_resolved_outcomes>');
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
