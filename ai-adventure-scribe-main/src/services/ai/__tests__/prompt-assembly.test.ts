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
 * 4. Two consecutive turns in the same scene share a prompt prefix covering
 *    the whole stable region (system + scene lore + character sheet +
 *    current scene); the first divergence sits at the first per-turn block
 *    (the input-matched lore tail, or the memories when there is no tail).
 */
import { describe, expect, it, vi } from 'vitest';

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
import { GameContextPrompts } from '../prompts/game-context-prompts';
import { approximateTokens } from '../shared/token-budget';

import type { Memory } from '../../memory-manager';
import type { StarterCampaignLore } from '../prompts/campaign-context-prompts';

// The character-section builder reads the sheet through the API; stub it to
// a fixed loadout so the sheet render is deterministic (and identical
// across the two measured turns, exactly as a real unchanged sheet is).
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCharacterLoadout: vi.fn(async () => ({
      weapons: [
        {
          name: 'Longbow',
          damageDice: '1d8',
          damageType: 'piercing',
          normalRange: 150,
          longRange: 600,
          ranged: true,
        },
      ],
      armor: ['Studded leather'],
      armorClass: 15,
    })),
    reportClientFailure: vi.fn(),
  },
}));

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
    characterSheet: '<game_context>char</game_context>',
    currentScene: '<current_scene>kitchen</current_scene>',
    loreInputTail: '<input_matched_lore>extra</input_matched_lore>',
    memories: '<story_memories>mem</story_memories>',
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
      '<game_context>',
      '<current_scene>',
      '<input_matched_lore>',
      '<story_memories>',
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
    const user = assembleUserPrompt({
      ...sections,
      loreInputTail: '',
      memories: '',
      tacticalContext: '',
    });
    expect(user).not.toContain('<input_matched_lore>');
    expect(user).not.toContain('<story_memories>');
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

describe('two consecutive turns in the same scene — shared prefix', () => {
  // The fixtures follow the real producers, assembled exactly as
  // ai-service's steady-state path assembles them: the system block, the
  // scene lore and the input-matched tail are rendered by the production
  // builders, the sheet by the real character-section builder (sheet API
  // stubbed above to a fixed loadout), and the memories by the real
  // memories builder. History, game state and scene state are pass-through
  // blocks in the assembly, so they are represented by the blocks the
  // caller hands over. The measured quantity is the prompt as the provider
  // sees it: system message + user message, concatenated.
  const lore = (() => {
    const extended = fakeLore();
    extended.entitiesByType.items.push(
      chunk('Silver Ladle', 'A silver ladle that never tarnishes or cools.'),
    );
    extended.entitiesByType.npcs.push(
      chunk('Mira the Cellarer', 'Mira keeps the cellar keys and the wine ledger.'),
    );
    return extended;
  })();

  const sceneOptions = {
    tokenBudget: 5000,
    recentTurnsText: 'The kitchen.\nquillon varr-hesk\neast kitchen',
    activeEntityNames: ['Quillon Varr-Hesk'],
    includeRoster: true as const,
    sceneOnly: true as const,
  };
  const currentScene =
    '<current_scene>\nThe East Kitchen, mid-morning. Copper pots steam over the hearth.\n</current_scene>';
  const ALL_ENTITY_NAMES = [
    'Quillon Varr-Hesk',
    'Mira the Cellarer',
    'East Kitchen',
    'Brass Thimble',
    'Silver Ladle',
  ];

  const turnContext = {
    characterDetails: {
      id: 'char-kael',
      name: 'Kael Thornwhisper',
      level: 3,
      race: 'Wood Elf',
      class: 'Ranger',
      background: 'Outlander',
      character_stats: [
        {
          strength: 12,
          dexterity: 17,
          constitution: 13,
          intelligence: 11,
          wisdom: 16,
          charisma: 10,
          armor_class: 15,
        },
      ],
    },
  } as never;

  function tailFor(playerInput: string, sceneKeptNames: string[]): string {
    const tail = CampaignContextPrompts.renderStarterCampaignLore(lore, {
      tokenBudget: 3000,
      recentTurnsText: sceneOptions.recentTurnsText,
      activeEntityNames: sceneOptions.activeEntityNames,
      turnScope: {
        playerInput,
        lastDmMessage: '',
        sceneText: 'The kitchen.',
        entityTokenBudget: 3000,
      },
      excludeEntityNames: sceneKeptNames,
      entitiesOnly: true,
    });
    return tail.keptEntities > 0
      ? `<input_matched_lore>\n${tail.section}\n</input_matched_lore>`
      : '';
  }

  async function assembleTurn(
    input: {
      playerInput: string;
      memories: Memory[];
      historySection: string;
      gameState: string;
      sceneState: string;
    },
    options?: { tailExcludeNames?: string[] },
  ): Promise<string> {
    const system = buildSystemPrompt({
      ...extractCampaignDetails(campaign),
      inCombat: false,
      voiceContext: null,
    });
    const sceneRender = CampaignContextPrompts.renderStarterCampaignLore(lore, sceneOptions);
    const sheet = await GameContextPrompts.buildUserCharacterSection(turnContext);
    const user = assembleUserPrompt({
      loreScene: sceneRender.section,
      characterSheet: sheet,
      currentScene,
      loreInputTail: tailFor(input.playerInput, options?.tailExcludeNames ?? sceneRender.keptEntityNames),
      memories: GameContextPrompts.buildUserMemoriesSection(input.memories),
      tacticalContext: '',
      historySection: input.historySection,
      gameState: input.gameState,
      turnFlagsLine: '',
      sceneState: input.sceneState,
      playerInput: input.playerInput,
    });
    return system + user;
  }

  function commonPrefixLength(a: string, b: string): number {
    const limit = Math.min(a.length, b.length);
    let index = 0;
    while (index < limit && a[index] === b[index]) index += 1;
    return index;
  }

  async function stablePrefix(): Promise<string> {
    const system = buildSystemPrompt({
      ...extractCampaignDetails(campaign),
      inCombat: false,
      voiceContext: null,
    });
    const sceneRender = CampaignContextPrompts.renderStarterCampaignLore(lore, sceneOptions);
    const sheet = await GameContextPrompts.buildUserCharacterSection(turnContext);
    return system + [sceneRender.section, sheet, currentScene].join('\n\n') + '\n\n';
  }

  const turn1 = {
    playerInput: 'Tell me about the brass thimble.',
    memories: [
      { type: 'event', content: 'Kael promised Quillon first taste of the stew.' },
      { type: 'fact', content: 'The blue tile by the east door is cracked.' },
    ] as unknown as Memory[],
    historySection:
      '<conversation_history>\nDM: The kitchen smells of nutmeg and woodsmoke.\n</conversation_history>',
    gameState: '<immutable_game_state>{"isInCombat":false,"round":1}</immutable_game_state>',
    sceneState: '<scene_state>\n- Quillon Varr-Hesk is in the East Kitchen.\n</scene_state>',
  };
  const turn2 = {
    playerInput: 'Ask Mira the Cellarer about the silver ladle.',
    memories: [
      { type: 'event', content: 'Quillon laughed at the story about the thimble.' },
      { type: 'relationship', content: 'Mira trusts Kael with the cellar keys.' },
    ] as unknown as Memory[],
    historySection:
      '<conversation_history>\nDM: The kitchen smells of nutmeg and woodsmoke.\n\nPlayer: Tell me about the brass thimble.\n\nDM: Quillon turns the thimble over in his palm.\n</conversation_history>',
    gameState: '<immutable_game_state>{"isInCombat":false,"round":2}</immutable_game_state>',
    sceneState:
      '<scene_state>\n- Quillon Varr-Hesk is in the East Kitchen.\n- The stew is simmering.\n</scene_state>',
  };

  it('covers the whole stable region; first divergence is the lore tail', async () => {
    const wire1 = await assembleTurn(turn1);
    const wire2 = await assembleTurn(turn2);
    const stable = await stablePrefix();

    // Precondition: both turns name a lore entity the scene section does
    // not carry, so both carry a non-empty input-matched tail.
    expect(wire1.slice(stable.length)).toMatch(/^<input_matched_lore>/);
    expect(wire2.slice(stable.length)).toMatch(/^<input_matched_lore>/);

    expect(wire1.startsWith(stable)).toBe(true);
    expect(wire2.startsWith(stable)).toBe(true);
    const divergence = commonPrefixLength(wire1, wire2);
    expect(divergence).toBeGreaterThanOrEqual(stable.length);

    // The shared prefix is the cacheable part of the turn: it must clear
    // the provider minimum on its own, and cover at least half the prompt
    // on this fixture (measured share is reported in the PR).
    expect(approximateTokens(wire1.slice(0, divergence))).toBeGreaterThan(
      DM_PROMPT_CACHE_MIN_STABLE_TOKENS,
    );
    expect(divergence / Math.min(wire1.length, wire2.length)).toBeGreaterThan(0.45);
  });

  it('with no input-matched tail, first divergence is the memories block', async () => {
    // The tail comes back empty when the scene section already carries
    // every entity the turn scope matches (the renderer's exclusion path —
    // ai-service wraps the tail only when the render kept entities).
    const wire1 = await assembleTurn(
      { ...turn1, playerInput: 'I stir the pot and wait.' },
      { tailExcludeNames: ALL_ENTITY_NAMES },
    );
    const wire2 = await assembleTurn(
      { ...turn2, playerInput: 'I taste the broth.' },
      { tailExcludeNames: ALL_ENTITY_NAMES },
    );
    const stable = await stablePrefix();

    expect(wire1.startsWith(stable)).toBe(true);
    expect(wire2.startsWith(stable)).toBe(true);
    expect(wire1.slice(stable.length)).toMatch(/^<story_memories>/);
    expect(wire2.slice(stable.length)).toMatch(/^<story_memories>/);
    expect(commonPrefixLength(wire1, wire2)).toBeGreaterThanOrEqual(stable.length);
  });
});
