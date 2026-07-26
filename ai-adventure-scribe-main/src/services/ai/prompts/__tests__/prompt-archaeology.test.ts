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
 * of an attack as a `roll_requests` entry, left over from the dice-fix wave. Instructions lose
 * to examples, so run 8's wave removed every attack-roll example and forbade them here.
 *
 * Run 9 showed what that cost. With no worked attack example left anywhere, the model emitted
 * no structured attacks at all — neither dialect, thirty turns, twenty-three attacks in pure
 * prose. The example was not the disease; the CONTRADICTION was. So exactly one block now
 * teaches attacks as roll requests on purpose, marked `INTENTIONAL_ELICITATION_DIALECT`, and
 * this test's job changes accordingly: the old dialect stays buried everywhere it would
 * contradict that block, and nowhere else. Two teachings is the failure mode, not one.
 */
const INTENTIONAL_MARKER = 'INTENTIONAL_ELICITATION_DIALECT';
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

describe('exactly one prompt section teaches an attack as a roll request', () => {
  it.each(Object.entries(everyPromptSection()))(
    '%s carries a worked attack roll_request example only if it is the marked block',
    (_name, section) => {
      const examples = section.match(ATTACK_ROLL_EXAMPLE) ?? [];
      if (!section.includes(INTENTIONAL_MARKER)) expect(examples).toEqual([]);
    },
  );

  /**
   * The marked blocks are the teaching, so their absence is the run 9 regression itself: a
   * prompt with no worked attack example is a prompt the model answers in prose.
   */
  it('the elicitation dialect is actually taught, with a worked example', () => {
    const marked = Object.entries(everyPromptSection()).filter(([, section]) =>
      section.includes(INTENTIONAL_MARKER),
    );
    expect(marked.map(([name]) => name).sort()).toEqual([
      'combatRollRequirements',
      // `rulesOfPlay` embeds the combat rules template, whose turn-flow example is worked in
      // the same dialect. It is marked because it teaches, not because it is a container.
      'rulesOfPlay',
      'spatialTurnContract',
    ]);
    expect(
      CombatRulesPrompts.buildCombatRollRequirementsSection().match(ATTACK_ROLL_EXAMPLE) ?? [],
    ).not.toEqual([]);
  });

  it('the roll request instructions keep their save and check examples', () => {
    const rules = RulesPrompts.buildRulesOfPlaySection();
    expect(rules).toContain('"type": "check"');
    expect(rules).toContain('"type": "save"');
    expect(rules).toContain('Death saving throw');
  });

  /**
   * The run 8 contradiction, guarded from the other side. No section may forbid the channel the
   * marked block teaches, because a prompt that both demands and forbids one dialect is the
   * prompt eleven correctives failed to argue their way out of.
   */
  it('no section forbids attacks in roll_requests while another teaches them there', () => {
    for (const [name, section] of Object.entries(everyPromptSection())) {
      expect(section, name).not.toMatch(/saving throws and ability checks ONLY/i);
      expect(section, name).not.toMatch(/do not put attacks in `?roll_requests`?/i);
      expect(section, name).not.toMatch(
        /an attack (?:you put |placed )?(?:t?here )?is (?:an attack )?not?(?: a roll)? (?:nobody rolls|anyone makes)/i,
      );
    }
  });

  it('every section that mentions attacks names a channel that reaches the engine', () => {
    const context = everyPromptSection().combatContext;
    expect(context).toMatch(/"type": "attack"/);
    expect(context).not.toMatch(/REQUEST\*\* dice rolls for player actions/);
  });

  it('no section still tells the DM to request damage rolls during combat', () => {
    for (const [name, section] of Object.entries(everyPromptSection())) {
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
