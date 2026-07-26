import { describe, it, expect } from 'vitest';

import { ContextBuilderPrompts } from '../../context-builder-prompts';
import { CombatRulesPrompts } from '../combat-rules-prompts';
import { RulesPrompts } from '../rules-prompts';

import type { CombatDetectionResult } from '@/utils/combatDetection';

/**
 * Prompt archaeology.
 *
 * Run 8's model ignored eleven consecutive correctives telling it to declare attacks in
 * `combat_actions`. It was not being stubborn: the same prompt still carried worked examples
 * of an attack as a `roll_requests` entry, left over from the dice-fix wave. Instructions
 * lose to examples. These tests are the shovel that keeps the old dialect from being reburied
 * somewhere in the prompt while the corrective goes on insisting otherwise.
 */
const everyPromptSection = (): Record<string, string> => ({
  rulesOfPlay: RulesPrompts.buildRulesOfPlaySection(),
  responseStructure: ContextBuilderPrompts.buildResponseStructureSection(),
  finalReminders: ContextBuilderPrompts.buildFinalRemindersSection(),
  combatRollRequirements: CombatRulesPrompts.buildCombatRollRequirementsSection(),
  spatialTurnContract: CombatRulesPrompts.buildSpatialTurnContractSection(),
  combatContext: CombatRulesPrompts.formatCombatContext({
    isCombat: true,
    combatType: 'melee',
    confidence: 0.9,
    shouldStartCombat: false,
    shouldEndCombat: false,
    enemies: [],
    combatActions: [],
  } as unknown as CombatDetectionResult),
});

/**
 * A worked example of an attack in `roll_requests`: a JSON-ish fragment that pairs
 * `"type": "attack"` with the roll-request field set. Saves and checks are deliberately not
 * matched — those examples are correct and stay.
 */
const ATTACK_ROLL_EXAMPLE = /\{[^{}]*"type"\s*:\s*"attack"[^{}]*"purpose"[^{}]*\}/g;

describe('no prompt section teaches an attack as a roll request', () => {
  it.each(Object.entries(everyPromptSection()))(
    '%s carries no worked attack roll_request example',
    (_name, section) => {
      expect(section.match(ATTACK_ROLL_EXAMPLE) ?? []).toEqual([]);
    },
  );

  it('the roll request instructions keep their save and check examples', () => {
    const rules = RulesPrompts.buildRulesOfPlaySection();
    expect(rules).toContain('"type": "check"');
    expect(rules).toContain('"type": "save"');
    expect(rules).toContain('Death saving throw');
  });

  it('the combat roll requirements name combat_actions as the attack channel', () => {
    const section = CombatRulesPrompts.buildCombatRollRequirementsSection();
    expect(section).toContain('combat_actions');
    expect(section).toMatch(/saving throws and ability checks ONLY/i);
  });

  it('the in-combat context block sends attacks to combat_actions, not roll_requests', () => {
    const combatContext = everyPromptSection().combatContext;
    expect(combatContext).toContain('combat_actions');
    expect(combatContext).not.toMatch(/REQUEST\*\* dice rolls for player actions/);
  });

  it('no section still tells the DM to request attack or damage rolls during combat', () => {
    for (const [name, section] of Object.entries(everyPromptSection())) {
      expect(section, name).not.toMatch(/Request attack rolls/i);
      expect(section, name).not.toMatch(/Request damage rolls after successful hits/i);
      expect(section, name).not.toMatch(/Requests attack \+ damage rolls/i);
    }
  });

  it('nothing asks the DM to move an attacker into reach: the engine does that', () => {
    for (const [name, section] of Object.entries(everyPromptSection())) {
      expect(section, name).not.toMatch(/emit a map_actions move within movementRemaining/i);
    }
  });
});
