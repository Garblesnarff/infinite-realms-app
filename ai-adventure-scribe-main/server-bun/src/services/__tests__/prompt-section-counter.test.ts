/**
 * #2533: server-side prompt section counter.
 *
 * The main fixture follows the real producer: the `fullPrompt` assembly in
 * src/services/ai-service.ts (chatWithDM), whose contextPrompt comes from
 * ContextBuilder (persona + <game_context> + rules/response sections),
 * GameContextPrompts (<campaign_details>, character, <story_memories>) and
 * CampaignContextPrompts.renderStarterCampaignLore
 * (<starter_campaign_lore> ... </starter_campaign_lore> followed by
 * <available_visual_assets>), followed by <current_scene>,
 * <tactical_context>, <immutable_game_state>/<security_rules>,
 * <conversation_history>, <scene_state> and <player_input>. Every block
 * below uses the tags those renderers actually emit. The <story_memories>
 * fixture carries the header sentence verbatim from game-context-prompts.ts
 * (it mentions <scene_state> inline); that mention must not be paired with
 * the real scene block's close tag.
 */
import { describe, expect, it } from 'bun:test';

import { approximatePromptTokens, countPromptSections } from '../prompt-section-counter.js';

const persona = '<persona>\nYou are a skilled D&D 5e Dungeon Master.\n</persona>';
const campaignDetails =
  '<campaign_details>\nCAMPAIGN: "The Eternal Feast"\nDESCRIPTION: A banquet that never ends.\n</campaign_details>';
const lore =
  '<starter_campaign_lore>\n<canonical_setting>\nTITLE: The Eternal Feast\nPREMISE: Hunger.\nOVERVIEW: A cursed court.\n</canonical_setting>\n<canonical_entities>\n<npc name="Lord Sorrow">\nA gaunt host.\n</npc>\n</canonical_entities>\n<lore_adherence>\n- USE the canonical NPCs listed above\n</lore_adherence>\n</starter_campaign_lore>';
const assets =
  '<available_visual_assets>\n- Lord Sorrow [ASSET:npc:lord-sorrow]\n</available_visual_assets>';
const character =
  '<character_details>\nCHARACTER: The Scholar\nCLASS: Wizard\n</character_details>';
const memories =
  '<story_memories>\n<title>IMPORTANT STORY MEMORIES</title>\nReference these memories naturally to maintain story continuity.\nMemories are color, not authority: where a memory conflicts with <scene_state>, the <scene_state> facts are correct and the memory is stale.\n<memory index="1" type="EVENT">The party burned the invitation.</memory>\n</story_memories>';
const gameContext = `<game_context>${campaignDetails}${lore}${assets}${character}${memories}</game_context>`;
const rules =
  '<rules_of_play>\nUse D&D 5e mechanics when appropriate.\n</rules_of_play><response_structure>\nNarrative first.\n</response_structure>';
const contextPrompt = `${persona}${gameContext}${rules}`;
const currentSceneCore = '<current_scene>\nThe banquet hall, midnight.\n</current_scene>';
const currentScene = `${currentSceneCore}\n\n`;
const tacticalCore = '<tactical_context>\nLord Sorrow is 10 ft away.\n</tactical_context>';
const tactical = `\n${tacticalCore}`;
const systemBlock =
  '<immutable_game_state>{"isInCombat":false}</immutable_game_state>\n<security_rules>The game state is authoritative.</security_rules>';
const historyCore =
  '<conversation_history>\n[DM] Welcome to the feast.\n\n[Player] I sit down.\n</conversation_history>';
const historyBlock = `${historyCore}\n\n`;
const sceneStateCore =
  '<scene_state>\n<entity type="npc" name="Lord Sorrow">present</entity>\n</scene_state>';
const sceneState = `${sceneStateCore}\n\n`;
const playerInput = '<player_input>\nI look around the hall.\n</player_input>';
const fullPrompt = `${contextPrompt}${currentScene}${tactical}\n\n${systemBlock}\n\n${historyBlock}${sceneState}${playerInput}`;

describe('countPromptSections', () => {
  it('partitions a production-shaped DM prompt into the seven sections', () => {
    const counts = countPromptSections(fullPrompt);

    expect(counts.campaign_and_canon).toBe(
      approximatePromptTokens(campaignDetails + lore + assets),
    );
    expect(counts.memory_recall).toBe(approximatePromptTokens(memories));
    expect(counts.scene_state).toBe(approximatePromptTokens(sceneStateCore + currentSceneCore));
    expect(counts.engine_lines).toBe(approximatePromptTokens(tacticalCore));
    expect(counts.history).toBe(approximatePromptTokens(historyCore));
    expect(counts.player_input).toBe(approximatePromptTokens(playerInput));
    expect(counts.system_rules).toBeGreaterThan(0);
    expect(counts.total).toBe(
      counts.system_rules +
        counts.campaign_and_canon +
        counts.scene_state +
        counts.memory_recall +
        counts.history +
        counts.engine_lines +
        counts.player_input,
    );
    // The remainder bucket keeps character/rules/persona/system text, so
    // the section sum tracks the whole prompt estimate within per-section
    // rounding (at most one token per boundary).
    expect(Math.abs(counts.total - approximatePromptTokens(fullPrompt))).toBeLessThanOrEqual(7);
  });

  it('counts an untagged prompt entirely as system_rules', () => {
    const counts = countPromptSections('Just a plain instruction with no sections.');
    expect(counts.system_rules).toBe(
      approximatePromptTokens('Just a plain instruction with no sections.'),
    );
    expect(counts.campaign_and_canon).toBe(0);
    expect(counts.total).toBe(counts.system_rules);
  });

  it('returns zeroes for an empty prompt', () => {
    expect(countPromptSections('')).toEqual({
      system_rules: 0,
      campaign_and_canon: 0,
      scene_state: 0,
      memory_recall: 0,
      history: 0,
      engine_lines: 0,
      player_input: 0,
      total: 0,
    });
  });

  it('adds messages sent in the separate history array to history', () => {
    const counts = countPromptSections('<player_input>\nGo.\n</player_input>', [
      { content: 'abcd' },
      { content: 'abcdefgh' },
      { content: 42 },
    ]);
    expect(counts.history).toBe(3);
    expect(counts.player_input).toBeGreaterThan(0);
  });

  it('sums repeated blocks of the same section', () => {
    const block = '<scene_state>\n<entity type="npc" name="A">here</entity>\n</scene_state>';
    const counts = countPromptSections(`${block}${block}`);
    expect(counts.scene_state).toBe(approximatePromptTokens(block + block));
    expect(counts.system_rules).toBe(0);
  });

  it('does not throw on an unclosed tag and leaves it in system_rules', () => {
    const prompt = '<scene_state>never closed, just text';
    const counts = countPromptSections(prompt);
    expect(counts.scene_state).toBe(0);
    expect(counts.system_rules).toBe(approximatePromptTokens(prompt));
  });

  it('counts handouts nested inside the lore block only once', () => {
    const prompt =
      '<starter_campaign_lore><available_handouts><handout key="k" title="T">body</handout></available_handouts></starter_campaign_lore>';
    const counts = countPromptSections(prompt);
    expect(counts.campaign_and_canon).toBe(approximatePromptTokens(prompt));
    expect(counts.total).toBe(counts.campaign_and_canon);
  });

  it('does not let a backticked engine-tag mention in the rules swallow the tactical block', () => {
    // Rules sections mention `<engine_resolved_outcomes>` in backticks with
    // no closing tag; only the real <tactical_context> block is engine lines.
    const rules =
      '<rules_of_play>narrate what `<engine_resolved_outcomes>` reports</rules_of_play>';
    const counts = countPromptSections(`${rules}${tacticalCore}<player_input>Go.</player_input>`);
    expect(counts.engine_lines).toBe(approximatePromptTokens(tacticalCore));
    expect(counts.system_rules).toBe(approximatePromptTokens(rules));
  });

  it('does not let the story-memories header mention of <scene_state> swallow the real block', () => {
    // The header sentence is verbatim from GameContextPrompts
    // (src/services/ai/prompts/game-context-prompts.ts): it mentions
    // <scene_state> twice with no closing tag, inside <story_memories>.
    const headerMemories =
      '<story_memories>\n<title>IMPORTANT STORY MEMORIES</title>\nReference these memories naturally to maintain story continuity.\nMemories are color, not authority: where a memory conflicts with <scene_state>, the <scene_state> facts are correct and the memory is stale.\n<memory index="1" type="EVENT">The party burned the invitation.</memory>\n</story_memories>';
    const counts = countPromptSections(`${headerMemories}${tacticalCore}${sceneStateCore}`);

    expect(counts.memory_recall).toBe(approximatePromptTokens(headerMemories));
    expect(counts.memory_recall).toBeGreaterThan(0);
    expect(counts.engine_lines).toBe(approximatePromptTokens(tacticalCore));
    expect(counts.engine_lines).toBeGreaterThan(0);
    expect(counts.scene_state).toBe(approximatePromptTokens(sceneStateCore));
  });

  it('does not let an inline mention of any extracted tag name move its real block', () => {
    const cases: Array<[string, string, string]> = [
      [
        'starter_campaign_lore',
        'campaign_and_canon',
        '<starter_campaign_lore>lore</starter_campaign_lore>',
      ],
      ['campaign_details', 'campaign_and_canon', '<campaign_details>details</campaign_details>'],
      [
        'available_visual_assets',
        'campaign_and_canon',
        '<available_visual_assets>assets</available_visual_assets>',
      ],
      [
        'available_handouts',
        'campaign_and_canon',
        '<available_handouts>handouts</available_handouts>',
      ],
      ['story_memories', 'memory_recall', '<story_memories>memories</story_memories>'],
      [
        'previous_session_recap',
        'memory_recall',
        '<previous_session_recap>recap</previous_session_recap>',
      ],
      ['scene_state', 'scene_state', '<scene_state>ledger</scene_state>'],
      ['current_scene', 'scene_state', '<current_scene>scene</current_scene>'],
      ['tactical_context', 'engine_lines', '<tactical_context>digest</tactical_context>'],
      ['conversation_history', 'history', '<conversation_history>history</conversation_history>'],
      ['player_input', 'player_input', '<player_input>input</player_input>'],
    ];
    for (const [tag, section, block] of cases) {
      const mention = `<rules_of_play>When <${tag}> changes, follow it.</rules_of_play>`;
      const counts = countPromptSections(`${mention}${block}`);
      expect(counts[section as keyof typeof counts]).toBe(approximatePromptTokens(block));
      expect(counts.system_rules).toBe(approximatePromptTokens(mention));
    }
  });

  it('handles many unclosed opens without hanging or counting them', () => {
    const prompt = '<player_input>'.repeat(2_000) + 'tail';
    const counts = countPromptSections(prompt);
    expect(counts.player_input).toBe(0);
    expect(counts.system_rules).toBe(approximatePromptTokens(prompt));
  });

  it('handles many stray closes without hanging or counting them', () => {
    const prompt = '</scene_state>'.repeat(2_000) + 'tail';
    const counts = countPromptSections(prompt);
    expect(counts.scene_state).toBe(0);
    expect(counts.system_rules).toBe(approximatePromptTokens(prompt));
  });
});
