import { createHash } from 'node:crypto';

import { describe, it, expect } from 'vitest';

import { CombatRulesPrompts } from '../combat-rules-prompts';
import { RulesPrompts } from '../rules-prompts';

import type { CombatDetectionResult } from '@/utils/combatDetection';

/** Prompt lines are wrapped, so a phrase is compared with its whitespace folded. */
const flat = (text: string): string => text.replace(/\s+/g, ' ');

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
     * The engine resolves attacks, spells and saves in combat and the client drops every DM roll_request while an
     * encounter is active (#2385). The prompt used to teach attacks, saves and checks as
     * roll_requests, which made the DM ask for rolls that never happen (#2400). The worked
     * declaration stays, in `combat_actions`: run 9's model stopped declaring without one.
     */
    it('teaches combat_actions as the only declaration channel, with a worked example', () => {
      const section = CombatRulesPrompts.buildCombatRollRequirementsSection();

      expect(section).toContain('<combat_roll_requirements>');
      expect(flat(section)).toContain('the engine resolves attacks, spells and saves');
      expect(section).toContain('`combat_actions`');
      expect(section).toContain(
        '{"actor_id": "the-seeker", "action_type": "attack", "target_ids": ["shadow-roach-1"]',
      );
      expect(section).toContain('"roll_requests": []');
      expect(section).toContain('INTENTIONAL_ELICITATION_DIALECT');
      expect(section).toContain('</combat_roll_requirements>');
    });

    it('carries no instruction to request a roll', () => {
      const section = CombatRulesPrompts.buildCombatRollRequirementsSection();

      expect(section).not.toContain('"type": "attack"');
      expect(section).not.toContain('"type": "save"');
      expect(section).not.toContain('"type": "check"');
      expect(section).not.toContain('<check_governance>');
      expect(section).not.toMatch(/declare an attack .* in `?roll_requests/i);
    });

    it('names the failure the floor exists to catch: declaring nothing at all', () => {
      const section = CombatRulesPrompts.buildCombatRollRequirementsSection();
      expect(section).toMatch(/narrating a swing in `text` and declaring nothing/);
    });
  });

  describe('buildSpatialTurnContractSection', () => {
    it('tells the DM to declare combat_actions and let the engine handle approach', () => {
      const section = CombatRulesPrompts.buildSpatialTurnContractSection();

      expect(section).toContain('<spatial_turn_contract>');
      expect(section).toContain('as a `combat_actions` entry');
      expect(section).toContain('walks the attacker');
      // The old instruction — emit a move yourself before attacking — is what the model
      // ignored for thirty turns. It must not survive anywhere in this section.
      expect(section).not.toContain('you MUST emit a `map_actions` move');
      expect(section).toContain('Approach before a strike is the engine');
      expect(section).toContain('NPC turns are already resolved by the engine');
      expect(section).toContain('do not declare or repair an NPC action');
      expect(section).toContain('</spatial_turn_contract>');
    });

    it('says the engine resolves attacks, spells and saves and carries no roll instruction', () => {
      const section = CombatRulesPrompts.buildSpatialTurnContractSection();

      expect(flat(section)).toContain('The engine resolves attacks, spells and saves');
      expect(section).toContain('`roll_requests` stays empty');
      expect(section).not.toContain('"type": "attack"');
      expect(section).not.toContain('"type":"attack"');
      expect(section).not.toContain('<check_governance>');
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
        expect(section).toContain('"action_type":');
        expect(section).not.toMatch(/Do NOT put attacks in `roll_requests`/i);
      }
    });

    it('works the three-roach example through engine-resolved NPC outcomes', () => {
      const section = CombatRulesPrompts.buildSpatialTurnContractSection();

      // NPC turns are engine-owned; only the player's declaration is model-authored.
      expect(section).toContain('"actor_id":"the-seeker","action_type":"attack"');
      expect(section).toContain('"target_ids":["shadow-roach-1"]');
      expect(section).not.toContain('"actor_id":"shadow-roach-1"');
      expect(section).not.toContain('"actor_id":"shadow-roach-2"');
      expect(section).toContain('Never emit or repair either roach');
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

    it('declares the attack as combat_actions and requests no roll', () => {
      const result = CombatRulesPrompts.formatCombatContext({
        isCombat: true,
        combatType: 'melee',
        confidence: 0.9,
        shouldStartCombat: false,
        shouldEndCombat: false,
      });

      expect(result).toContain('as a `combat_actions` entry');
      expect(flat(result)).toContain('The engine resolves attacks, spells and saves');
      expect(result).not.toContain('"type": "attack"');
      expect(result).not.toMatch(/entry in `roll_requests`/);
    });
  });

  describe('the prompt outside combat (#2400)', () => {
    const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

    // GUARD, not a spec: pins the out-of-combat rules of play to the bytes origin/main had before
    // #2400. A deliberate edit to that prompt fails it; update the hash in the same PR. The other
    // out-of-combat sections are pinned in context-builder-in-combat-prompt.test.ts.
    it('is byte-identical to the prompt before the in-combat change', () => {
      const notCombat: CombatDetectionResult = {
        isCombat: false,
        combatType: 'none',
        confidence: 0,
        shouldStartCombat: false,
        shouldEndCombat: false,
      };

      expect(CombatRulesPrompts.formatCombatContext(notCombat)).toBe('');
      const rules = RulesPrompts.buildRulesOfPlaySection();
      expect(rules).toHaveLength(26874);
      expect(sha256(rules)).toBe(
        'b914eda1af7159cd8d0232c0d01ae147034d7a7f40df3d5ab6d5ec226daa667c',
      );
    });
  });
});
