import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContextBuilder } from '../context-builder';
import { ContextBuilderPrompts } from '../context-builder-prompts';
import { RulesPrompts } from '../prompts/rules-prompts';

import type { CombatDetectionResult } from '@/utils/combatDetection';

/**
 * #2400: the engine resolves attacks, spells and saves in combat and the client drops every DM
 * roll_request (#2385). Every section the real builder sends on an in-combat turn must say so,
 * because the last section of the prompt wins and a single leftover "declare it as a roll request"
 * is enough to bring the dropped requests back.
 */
const combat = (isCombat: boolean): CombatDetectionResult => ({
  isCombat,
  combatType: isCombat ? 'melee' : 'none',
  confidence: isCombat ? 0.9 : 0,
  shouldStartCombat: false,
  shouldEndCombat: false,
  enemies: [],
  combatActions: [],
});

const buildPrompt = async (isCombat: boolean): Promise<string> => {
  // Only the game-context section is stubbed: it reads campaign and character data.
  vi.spyOn(ContextBuilderPrompts, 'buildGameContextSection').mockResolvedValue('<game_context/>');
  return ContextBuilder.build({
    context: { campaignId: 'c', characterId: 'p' } as never,
    message: 'I attack the goblin',
    relevantMemories: [],
    combatDetection: combat(isCombat),
    voiceContext: { narratorVoice: 'v' } as never,
    isFirstMessage: false,
  });
};

/** A line may mention roll_requests only to say it stays empty or that nothing is requested. */
const ALLOWED_ROLL_REQUEST_LINE = /\[\]|stays empty|empty array|do not request|never request/i;

describe('the whole in-combat prompt (#2400)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('contains every combat section, so the test below covers what ships', async () => {
    const prompt = await buildPrompt(true);

    for (const tag of [
      '<rules_of_play>',
      'COMBAT CONTEXT DETECTED:',
      '<combat_roll_requirements>',
      '<spatial_turn_contract>',
      '<response_structure>',
      '<combat_declaration_format>',
      '<final_reminders>',
    ]) {
      expect(prompt).toContain(tag);
    }
  });

  it('teaches no roll_request, attack roll, save roll or check roll anywhere', async () => {
    const prompt = await buildPrompt(true);

    expect(prompt).not.toMatch(/"type"\s*:\s*"(attack|check|save|damage|initiative)"/);
    for (const line of prompt.split('\n').filter((l) => /roll[_ ]requests?/i.test(l))) {
      expect(line).toMatch(ALLOWED_ROLL_REQUEST_LINE);
    }
    for (const heading of [
      'DICE ROLLS ARE MANDATORY',
      'WHEN TO REQUEST DICE ROLLS',
      'HOW TO REQUEST ROLLS',
      'REQUEST ROLLS BEFORE NARRATING',
      'MANDATORY: DICE ROLL FORMAT',
      '<roll_request_format>',
      '<dice_roll_format>',
      '<check_governance>',
      '<critical_roll_stopping_rule>',
    ]) {
      expect(prompt).not.toContain(heading);
    }
    // Whitespace is folded so a sentence wrapped across two lines is still one sentence.
    const flat = prompt.replace(/\s+/g, ' ');
    expect(flat).not.toMatch(/(?<!not |never )request (?:a |the )?(?:roll|initiative|saving)/i);
    expect(flat).not.toMatch(/\badd (?:an )?entry to the `roll_requests`/i);
  });

  it('ends on the combat reminder, not the dice reminder', async () => {
    const prompt = await buildPrompt(true);
    const tail = prompt.slice(prompt.lastIndexOf('<final_reminders>'));

    expect(tail).toContain('DO NOT REQUEST ROLLS');
    expect(tail).toContain('`combat_actions`');
  });
});

describe('the prompt outside combat (#2400)', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends the out-of-combat variants when no combat was detected', async () => {
    vi.spyOn(ContextBuilderPrompts, 'buildGameContextSection').mockResolvedValue('<game_context/>');
    const prompt = await ContextBuilder.build({
      context: { campaignId: 'c', characterId: 'p' } as never,
      message: 'I look around',
      relevantMemories: [],
      isFirstMessage: false,
    });

    expect(prompt).toContain('<roll_request_format>');
    expect(prompt).not.toContain('<combat_declaration_format>');
  });

  it('still teaches roll_requests, including the attack declaration', async () => {
    const prompt = await buildPrompt(false);

    expect(prompt).toContain('<roll_request_format>');
    expect(prompt).toContain('<dice_roll_format>');
    expect(prompt).toContain('EVERY COMBAT ATTACK MUST BE DECLARED');
    expect(prompt).not.toContain('<combat_declaration_format>');
  });

  it('teaches the xp_award field out of combat only (#218 step 2)', async () => {
    expect(await buildPrompt(false)).toContain('<xp_award_field>');
    expect(await buildPrompt(true)).not.toContain('<xp_award_field>');
  });

  /**
   * GUARD, not a spec: this pins the out-of-combat prompt to the bytes it had before #2400 split
   * out the combat variants. It exists so the split cannot change what a non-combat turn sends.
   * A deliberate edit to these sections will fail it: update the hashes in that same PR.
   * #2533 re-pinned the rules-of-play hash after condensing the five engine-owned combat blocks.
   * #218 step 2 re-pinned the response-structure hash after adding the out-of-combat XP field.
   */
  it('keeps the byte-identical sections it had before the combat variants existed', () => {
    const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

    expect(sha256(RulesPrompts.buildRulesOfPlaySection())).toBe(
      'f119ee187786252d48e7ebc27edce36870089a10e3297bcd55584c703cfb0797',
    );
    expect(sha256(ContextBuilderPrompts.buildResponseStructureSection())).toBe(
      '57ce4fb470a135ba53a581f9bdf26780c65d77327b3c64b59a9a42ea4b490c0a',
    );
    expect(sha256(ContextBuilderPrompts.buildFinalRemindersSection())).toBe(
      'f73f18110ce03c6aca6e4a04932ba834ce476d71c27392f86d1b4b81221fada2',
    );
  });
});
