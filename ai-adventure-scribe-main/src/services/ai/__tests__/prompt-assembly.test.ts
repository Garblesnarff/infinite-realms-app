/**
 * #352: prompt-caching layout tests. No live provider calls: every builder
 * under test is pure string assembly.
 *
 * The contract under test:
 * 1. Two consecutive turns in the same scene produce a byte-identical system
 *    prompt (the cached prefix) of at least DM_PROMPT_CACHE_MIN_STABLE_TOKENS
 *    tokens.
 * 2. Per-turn flags never appear inside that prefix.
 * 3. The scene-stable lore section is byte-identical across same-scene turns
 *    and refreshes when the scene changes.
 */
import { describe, expect, it } from 'vitest';

import {
  assembleUserPrompt,
  buildSceneKey,
  buildSystemPrompt,
  buildTurnFlagsLine,
  DM_PROMPT_CACHE_MIN_STABLE_TOKENS,
  extractCampaignDetails,
  SceneLoreCache,
  SECURITY_RULES_BASE_TEXT,
} from '../prompt-assembly';
import { CampaignContextPrompts } from '../prompts/campaign-context-prompts';
import { approximateTokens } from '../shared/token-budget';

import type { StarterCampaignLore } from '../prompts/campaign-context-prompts';

const campaign = {
  campaignDetails: {
    name: 'The Academy of Arcane Gastronomy',
    description: 'A culinary academy where magic is cooked into every dish.',
  },
} as never;

function chunk(name: string, content: string): StarterCampaignLore['entitiesByType']['npcs'][number] {
  return { entityName: name, content } as never;
}

function fakeLore(): StarterCampaignLore {
  return {
    title: 'Academy',
    premise: 'Cook magic.',
    creativeBrief: 'Cozy.',
    overviewText: 'A school.',
    rules: [],
    entitiesByType: {
      npcs: [chunk('Quillon Varr-Hesk', 'The head cook. Exact name Quillon Varr-Hesk.')],
      locations: [chunk('East Kitchen', 'The east kitchen has a cracked blue tile by the east door.')],
      factions: [],
      items: [chunk('Brass Thimble', 'A brass thimble etched with a heron.')],
      monsters: [],
      handouts: [],
    },
    assetsSection: '',
  } as StarterCampaignLore;
}

describe('buildSystemPrompt', () => {
  const input = {
    ...extractCampaignDetails(campaign),
    inCombat: false,
    voiceContext: null,
  };

  it('is byte-identical across turns with different player inputs', () => {
    // The player input never enters the system block; two turns that differ
    // only in volatile content must produce the identical prefix.
    const a = buildSystemPrompt(input);
    const b = buildSystemPrompt({ ...input });
    expect(a).toBe(b);
  });

  it('has a stable prefix of at least the minimum cacheable size', () => {
    const system = buildSystemPrompt(input);
    expect(approximateTokens(system)).toBeGreaterThanOrEqual(
      DM_PROMPT_CACHE_MIN_STABLE_TOKENS,
    );
  });

  it('has exactly two variants: in and out of combat', () => {
    const out = buildSystemPrompt(input);
    const inCombat = buildSystemPrompt({ ...input, inCombat: true });
    expect(inCombat).not.toBe(out);
    // Same variant twice is still identical.
    expect(buildSystemPrompt({ ...input, inCombat: true })).toBe(inCombat);
  });

  it('contains the stable sections and the security base text', () => {
    const system = buildSystemPrompt(input);
    expect(system).toContain('<persona>');
    expect(system).toContain('The Academy of Arcane Gastronomy');
    expect(system).toContain('<response_structure>');
    expect(system).toContain(SECURITY_RULES_BASE_TEXT);
  });

  it('emits the voice JSON reminder only when voice is enabled', () => {
    const without = buildSystemPrompt(input);
    expect(without).not.toContain('REMEMBER: Always respond in the JSON format');
    const withVoice = buildSystemPrompt({
      ...input,
      voiceContext: { voiceId: 'v1' } as never,
    });
    expect(withVoice).toContain('REMEMBER: Always respond in the JSON format');
    // The reminder sits between the response structure and the final reminders.
    expect(withVoice.indexOf('REMEMBER: Always respond')).toBeGreaterThan(
      withVoice.indexOf('<response_structure>'),
    );
    expect(withVoice.indexOf('REMEMBER: Always respond')).toBeLessThan(
      withVoice.indexOf('<final_reminders>'),
    );
  });
});

describe('buildTurnFlagsLine', () => {
  it('is empty when no flags are set', () => {
    expect(
      buildTurnFlagsLine({ resolutionOnly: false, combatEntryDeclined: null, narrationViolation: null }),
    ).toBe('');
  });

  it('carries each per-turn flag', () => {
    const line = buildTurnFlagsLine({
      resolutionOnly: true,
      combatEntryDeclined: 'Goblin',
      narrationViolation: 'Do not narrate the stew.',
    });
    expect(line).toContain('<turn_flags>');
    expect(line).toContain('resolved-result narration pass');
    expect(line).toContain('Goblin');
    expect(line).toContain('Do not narrate the stew.');
  });

  it('per-turn flags never appear inside the system prefix', () => {
    const system = buildSystemPrompt({
      ...extractCampaignDetails(campaign),
      inCombat: false,
      voiceContext: null,
    });
    const flags = buildTurnFlagsLine({
      resolutionOnly: true,
      combatEntryDeclined: 'Goblin',
      narrationViolation: 'Do not narrate the stew.',
    });
    expect(system).not.toContain('resolved-result narration pass');
    expect(system).not.toContain('chose not to strike');
    expect(system).not.toContain('Do not narrate the stew.');
    expect(flags).not.toBe('');
  });

  it('a declined entry keeps the hostile in the scene (#400)', () => {
    const line = buildTurnFlagsLine({
      resolutionOnly: false,
      combatEntryDeclined: 'an attack against the goblin',
      narrationViolation: null,
    });
    expect(line).toContain('chose not to strike');
    expect(line).toContain('still in the scene');
  });
});

describe('assembleUserPrompt', () => {
  const sections = {
    loreScene: '<starter_campaign_lore>scene</starter_campaign_lore>',
    loreInputTail: '<input_matched_lore>extra</input_matched_lore>',
    userGameContext: '<game_context>char</game_context>',
    currentScene: '<current_scene>kitchen</current_scene>',
    tacticalContext: '',
    historySection: '<conversation_history>hi</conversation_history>',
    gameState: '<immutable_game_state>{}</immutable_game_state>',
    turnFlagsLine: '',
    sceneState: '<scene_state>facts</scene_state>',
    playerInput: 'I stir the stew.',
  };

  it('orders stable -> volatile with scene state immediately before player input', () => {
    const user = assembleUserPrompt(sections);
    const order = [
      '<starter_campaign_lore>',
      '<input_matched_lore>',
      '<game_context>',
      '<current_scene>',
      '<conversation_history>',
      '<immutable_game_state>',
      '<scene_state>',
      '<player_input>',
    ];
    let last = -1;
    for (const marker of order) {
      const at = user.indexOf(marker);
      expect(at).toBeGreaterThan(last);
      last = at;
    }
  });

  it('omits empty optional sections', () => {
    const user = assembleUserPrompt({ ...sections, loreInputTail: '', tacticalContext: '' });
    expect(user).not.toContain('<input_matched_lore>');
  });
});

describe('SceneLoreCache', () => {
  it('hits on the same scene and misses when the scene changes', () => {
    const cache = new SceneLoreCache();
    const key = { sessionId: 's1', starterCampaignId: 'c1', sceneKey: 'kitchen|a' };
    expect(cache.get(key)).toBeNull();
    cache.set(key, { section: 'LORE', keptEntityNames: ['quillon varr-hesk'], canonCut: true });
    expect(cache.get(key)).toEqual({
      section: 'LORE',
      keptEntityNames: ['quillon varr-hesk'],
      canonCut: true,
    });
    // Scene changed -> miss.
    expect(
      cache.get({ ...key, sceneKey: 'cellar|a' }),
    ).toBeNull();
    // Different session -> miss.
    expect(cache.get({ ...key, sessionId: 's2' })).toBeNull();
  });

  it('buildSceneKey is stable for the same scene and sensitive to scene inputs', () => {
    const base = {
      currentSceneDescription: 'The kitchen.',
      activeEntityNames: ['Quillon Varr-Hesk', 'East Kitchen'],
    };
    expect(buildSceneKey(base)).toBe(buildSceneKey({ ...base }));
    expect(buildSceneKey({ ...base, currentSceneDescription: 'The cellar.' })).not.toBe(
      buildSceneKey(base),
    );
    // Entity order does not matter.
    expect(
      buildSceneKey({ ...base, activeEntityNames: ['East Kitchen', 'Quillon Varr-Hesk'] }),
    ).toBe(buildSceneKey(base));
    // The per-turn budget is NOT part of the key (it is volatile per turn).
    expect(buildSceneKey(base)).toBe(
      buildSceneKey({ ...base, activeEntityNames: ['Quillon Varr-Hesk', 'East Kitchen'] }),
    );
  });
});

describe('scene-stable lore rendering', () => {
  const lore = fakeLore();
  // Production's scene render passes sceneOnly: true (ai-service.ts), so the
  // tests use the same shape.
  const sceneOptions = {
    tokenBudget: 5000,
    recentTurnsText: 'The kitchen.\nquillon varr-hesk\neast kitchen',
    activeEntityNames: ['Quillon Varr-Hesk'],
    includeRoster: true as const,
    sceneOnly: true as const,
  };

  it('is byte-identical across turns that differ only in player input', () => {
    // The scene render takes no turnScope: the player's words cannot change it.
    const a = CampaignContextPrompts.renderStarterCampaignLore(lore, sceneOptions);
    const b = CampaignContextPrompts.renderStarterCampaignLore(lore, sceneOptions);
    expect(a.section).toBe(b.section);
    expect(a.keptEntityNames).toContain('quillon varr-hesk');
  });

  it('carries the full canon name roster so the DM never invents a stand-in', () => {
    const rendered = CampaignContextPrompts.renderStarterCampaignLore(lore, sceneOptions);
    expect(rendered.section).toContain('<canon_roster>');
    expect(rendered.section).toContain('Brass Thimble');
  });

  it('the input-matched tail excludes entities the scene section already keeps', () => {
    // The scene render keeps the active cook; the tail is rendered with the
    // scene's kept names excluded, so it never duplicates the scene section.
    const tail = CampaignContextPrompts.renderStarterCampaignLore(lore, {
      tokenBudget: 3000,
      recentTurnsText: 'Tell me about the brass thimble.',
      activeEntityNames: ['Quillon Varr-Hesk'],
      turnScope: {
        playerInput: 'Tell me about the brass thimble.',
        lastDmMessage: '',
        sceneText: 'The kitchen.',
        entityTokenBudget: 3000,
      },
      excludeEntityNames: ['quillon varr-hesk'],
      entitiesOnly: true,
    });
    // The scene's cook card is not duplicated in the tail.
    expect(tail.section).not.toContain('Quillon Varr-Hesk');
    // The input-named thimble card is carried by the tail.
    expect(tail.section).toContain('Brass Thimble');
    // The tail is only the entity cards, not the setting head or roster.
    expect(tail.section).not.toContain('<canonical_setting>');
    expect(tail.section).not.toContain('<canon_roster>');
  });

  it('sceneOnly keeps scene entities even under a tiny budget', () => {
    // Scene entities are always kept (#2450), so a tiny budget cannot cut
    // them — canonCut stays false and the section exceeds the budget by
    // design. The roster is still emitted (budget-exempt).
    const tight = CampaignContextPrompts.renderStarterCampaignLore(lore, {
      ...sceneOptions,
      tokenBudget: 10,
    });
    expect(tight.canonCut).toBe(false);
    expect(tight.keptEntityNames).toContain('quillon varr-hesk');
    expect(tight.section).toContain('<canon_roster>');
  });
});
