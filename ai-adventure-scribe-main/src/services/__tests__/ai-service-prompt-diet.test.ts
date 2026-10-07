/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  countPromptSections,
  type PromptSectionTokenCounts,
} from '../../../server-bun/src/services/prompt-section-counter';
import {
  FIXTURE_CAMPAIGN_ID,
  FIXTURE_CHARACTER,
  FIXTURE_CURRENT_SCENE,
  FIXTURE_LOADOUT,
  FIXTURE_MEMORIES,
  FIXTURE_OPENING_DM,
  FIXTURE_OVERVIEW,
  FIXTURE_RULES,
  FIXTURE_TURNS,
  fixtureAssetsSection,
  fixtureEntities,
  fixtureSceneState,
} from '../ai/__tests__/fixtures/prompt-diet-session';
import { processDMResponse } from '../ai/dm-response-processor';
import { enforceNarrationContract } from '../ai/narration-contract-check';
import { AIService } from '../ai-service';
import { MemoryManager } from '../memory-manager';
import { fetchSceneState } from '../narrative/scene-state-client';
import { SessionStateService } from '../session-state-service';

import type { ChatMessage } from '../ai/shared/types';

import { getLoreKeeperService } from '@/agents/services/lore-keeper/LoreKeeperService';
import { llmApiClient } from '@/infrastructure/api';
import { fetchCampaignAssetsForPrompt } from '@/services/ai/asset-processor';

vi.mock('@/infrastructure/api', () => ({
  llmApiClient: { generateText: vi.fn() },
}));
vi.mock('../memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn(), saveMemories: vi.fn(), extractMemories: vi.fn() },
}));
vi.mock('../ai/dm-response-processor', () => ({
  processDMResponse: vi.fn(),
  processDMResponseSideEffects: vi.fn(),
  runDeferredDMResponseWork: vi.fn(),
}));
vi.mock('../ai/campaign-generator', () => ({
  generateCampaignDescription: vi.fn(),
  generateCampaignName: vi.fn(),
}));
vi.mock('../ai/narration-contract-check', () => ({ enforceNarrationContract: vi.fn() }));
vi.mock('../narrative/scene-state-client', () => ({ fetchSceneState: vi.fn() }));
vi.mock('../session-state-service', () => ({
  SessionStateService: { getLatestRollOutcome: vi.fn() },
}));
vi.mock('@/agents/services/lore-keeper/LoreKeeperService', () => ({
  getLoreKeeperService: vi.fn(),
}));
vi.mock('@/services/ai/asset-processor', () => ({ fetchCampaignAssetsForPrompt: vi.fn() }));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getCharacterLoadout: vi.fn(),
    reportClientFailure: vi.fn(),
  },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const median = (values: number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
};

const message = (id: string, speakerType: 'player' | 'dm', content: string): ChatMessage => ({
  id,
  role: speakerType === 'player' ? 'user' : 'assistant',
  content,
  timestamp: new Date('2026-10-01T19:00:00Z'),
  speakerType,
});

interface SessionRun {
  greeting: PromptSectionTokenCounts;
  turns: PromptSectionTokenCounts[];
  prompts: string[];
}

/**
 * Plays the fixture session through the real `AIService.chatWithDM` -> `ContextBuilder` path and
 * counts every prompt with the server's own `[PromptSections]` counter. Only I/O is stubbed.
 */
let sessionCounter = 0;

async function playFixtureSession(): Promise<SessionRun> {
  // A fresh session id per play: chatWithDM de-duplicates identical in-flight calls for 2 s.
  sessionCounter += 1;
  const sessionId = `fixture-session-${sessionCounter}`;
  const counts: PromptSectionTokenCounts[] = [];
  const prompts: string[] = [];
  const history: ChatMessage[] = [];

  const callDm = async (turnIndex: number, playerMessage: string): Promise<void> => {
    vi.mocked(fetchSceneState).mockResolvedValue(fixtureSceneState(turnIndex));
    await AIService.chatWithDM({
      message: playerMessage,
      context: {
        sessionId,
        campaignId: FIXTURE_CAMPAIGN_ID,
        characterId: FIXTURE_CHARACTER.id,
        starterCampaignId: 'fixture-starter',
        isStarterPlaythrough: true,
        campaignDetails: { name: FIXTURE_OVERVIEW.title, description: FIXTURE_OVERVIEW.premise },
        characterDetails: FIXTURE_CHARACTER,
        currentSceneDescription: turnIndex > 0 ? FIXTURE_CURRENT_SCENE : undefined,
        gameState: { isInCombat: false },
      } as any,
      conversationHistory: [...history],
    });
    const call = vi.mocked(llmApiClient.generateText).mock.calls.at(-1)?.[0] as any;
    prompts.push(call.prompt);
    counts.push(countPromptSections(call.prompt, call.history));
  };

  await callDm(0, '');
  history.push(message('dm-0', 'dm', FIXTURE_OPENING_DM));
  for (let k = 1; k <= FIXTURE_TURNS.length; k += 1) {
    const turn = FIXTURE_TURNS[k - 1];
    await callDm(k, turn.player);
    history.push(message(`p-${k}`, 'player', turn.player));
    history.push(message(`dm-${k}`, 'dm', turn.dm));
  }
  return { greeting: counts[0], turns: counts.slice(1), prompts };
}

describe('DM prompt budget on the fixed fixture session (#2533)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const entities = fixtureEntities();
    vi.mocked(getLoreKeeperService).mockReturnValue({
      getCampaignOverview: vi.fn().mockResolvedValue(FIXTURE_OVERVIEW),
      getRules: vi.fn().mockResolvedValue(FIXTURE_RULES),
      getEntities: vi.fn().mockResolvedValue(entities),
    } as any);
    vi.mocked(fetchCampaignAssetsForPrompt).mockResolvedValue(fixtureAssetsSection());
    vi.mocked(MemoryManager.getRelevantMemories).mockResolvedValue(FIXTURE_MEMORIES as any);
    vi.mocked(SessionStateService.getLatestRollOutcome).mockResolvedValue(null);
    vi.mocked(llmApiClient.generateText).mockResolvedValue('AI RAW Response');
    vi.mocked(processDMResponse).mockResolvedValue({ text: 'Processed Text' } as any);
    vi.mocked(enforceNarrationContract).mockImplementation(async (raw: string) => raw);
    return import('@/services/user-data-api').then(({ userDataApi }) => {
      vi.mocked(userDataApi.getCharacterLoadout).mockResolvedValue(FIXTURE_LOADOUT as any);
    });
  });

  /**
   * Medians over the 22 DM turns of this fixture, measured with this same test on origin/main
   * 84fc56268 (before #2533). They are constants because main's prompt is no longer reachable
   * from this code; regenerate them only by re-running this test on that commit.
   */
  const BASELINE = {
    system_rules: 8303,
    campaign_and_canon: 10689,
    history: 2241,
    total: 21738,
  };
  const KEYS = [
    'system_rules',
    'campaign_and_canon',
    'scene_state',
    'memory_recall',
    'history',
    'engine_lines',
    'player_input',
    'total',
  ] as const;

  it('cuts the median DM prompt by at least 40% against the pre-#2533 baseline', async () => {
    const run = await playFixtureSession();
    expect(run.turns).toHaveLength(22);
    const medians = Object.fromEntries(
      KEYS.map((key) => [key, median(run.turns.map((counts) => counts[key]))]),
    ) as Record<(typeof KEYS)[number], number>;
    if (process.env.PROMPT_DIET_TABLE) {
      const lines = [
        `[PromptSections] opening ${JSON.stringify(run.greeting)}`,
        ...run.turns.map((counts, i) => `[PromptSections] turn ${i + 1} ${JSON.stringify(counts)}`),
        `[PromptSections] median ${JSON.stringify(medians)}`,
      ];
      process.stdout.write(`${lines.join('\n')}\n`);
    }

    expect(medians.total).toBeLessThanOrEqual(BASELINE.total * 0.6);
    // Each of the three sections #2533 targets is down, and by the amount it was meant to be.
    expect(medians.campaign_and_canon).toBeLessThanOrEqual(BASELINE.campaign_and_canon * 0.4);
    expect(medians.system_rules).toBeLessThan(BASELINE.system_rules);
    expect(medians.history).toBeLessThanOrEqual(BASELINE.history * 0.6);
    // The counter's sections still sum to the total, so the cut is not a re-labelling.
    for (const counts of run.turns) {
      expect(
        counts.system_rules +
          counts.campaign_and_canon +
          counts.scene_state +
          counts.memory_recall +
          counts.history +
          counts.engine_lines +
          counts.player_input,
      ).toBe(counts.total);
    }
  });

  it('stops history growing: it stays flat once the 12-message cap is reached', async () => {
    const run = await playFixtureSession();
    const history = run.turns.map((counts) => counts.history);
    // Messages in history before turn k: 1 opening + 2 per earlier turn, so the cap binds from turn 6.
    expect(Math.max(...history.slice(6))).toBeLessThanOrEqual(Math.min(...history.slice(6)) * 1.35);
    expect(history[21]).toBeLessThan(history[11] * 1.25);

    // Turn 22's prompt carries turns 16-21 (12 messages) as history, and its own input separately.
    const last = run.prompts[22];
    expect(last).toContain(`Player: ${FIXTURE_TURNS[20].player}`);
    expect(last).toContain(FIXTURE_TURNS[20].dm.slice(0, 80));
    expect(last).toContain(`Player: ${FIXTURE_TURNS[15].player}`);
    expect(last).not.toContain(`Player: ${FIXTURE_TURNS[14].player}`);
    expect(last).not.toContain(FIXTURE_OPENING_DM.slice(0, 80));
  });

  it("sends canon for the scene and for what the turn names, and nothing else's card", async () => {
    const run = await playFixtureSession();

    // Turn 19: the previous reply left the party in the Drowned Chapel with Brother Tobin Vale
    // (both in the ledger scene); the player's own words name neither.
    const chapelTurn = run.prompts[19];
    expect(chapelTurn).toContain('<npc name="Brother Tobin Vale"');
    expect(chapelTurn).toContain('<location name="The Drowned Chapel"');
    expect(chapelTurn).not.toContain('<npc name="Madam Orsolya Finch"');
    expect(chapelTurn).not.toContain('<npc name="Captain Dessa Korr"');
    expect(chapelTurn).not.toContain('<location name="Salt Market"');
    // Everything left out is still named, so nothing is replaced by an invented stand-in.
    expect(chapelTurn).toMatch(/NPCs: [^\n]*Madam Orsolya Finch/);
    expect(chapelTurn).toMatch(/Locations: [^\n]*Salt Market/);

    // Turn 9: Captain Korr is in the ledger scene and the player's input names Warden Marrek, who
    // is not: both cards come with the turn.
    const korrTurn = run.prompts[9];
    expect(korrTurn).toContain('<npc name="Captain Dessa Korr"');
    expect(korrTurn).toContain('<npc name="Warden Isolde Marrek"');
  });

  it('sends the whole campaign for the opening, which has no scene to select from', async () => {
    const run = await playFixtureSession();
    expect(run.greeting.campaign_and_canon).toBeGreaterThanOrEqual(BASELINE.campaign_and_canon);
    expect(run.prompts[0]).not.toContain('<canon_roster>');
    expect(run.prompts[0]).toContain('<npc name="Madam Orsolya Finch"');
    expect(run.prompts[0]).toContain('<monster name="The Unlit Thing"');
  });

  it('keeps every authored handout deliverable by key on every turn', async () => {
    const run = await playFixtureSession();
    for (const prompt of run.prompts) {
      for (const key of [
        'torn-ledger-page',
        'guild-route-map',
        'chapel-litany',
        'magistrates-summons',
        'nims-note',
      ]) {
        expect(prompt).toContain(`key="${key}"`);
      }
    }
  });

  /**
   * The fabrication guards (#2524, #2341/#2342, #2236 family) live in prompt text. A diet that
   * trimmed one would pass every size check above, so each turn's prompt must still carry them.
   */
  it('keeps the fabrication guards and the canon-adherence rules on every turn', async () => {
    const run = await playFixtureSession();
    const flat = (text: string): string => text.replace(/\s+/g, ' ');
    // The opening prompt is a different template (no rules of play); every DM turn after it is this one.
    for (const prompt of run.prompts.slice(1)) {
      const text = flat(prompt);
      for (const guard of [
        // system block (security_rules)
        'The game state is authoritative.',
        'Never invent rolls, HP, inventory, conditions, or outcomes.',
        'prose has no state authority',
        // rules of play + combat rules
        'CRITICAL: NEVER NARRATE NUMERIC HIT POINTS',
        'An attack that appears only in your narration is an attack that never happened',
        'DO NOT narrate results of uncertain actions before the player rolls!',
        'YOUR TURN IS COMPLETE',
        'those numbers came from nowhere',
        "NPC turns are already resolved by the engine before the player's declaration",
        "CRITICAL: PRESERVE THE PLAYER'S DECLARED ACTION",
        // the engine owns what was condensed
        'The engine decides every critical hit and fumble',
        'The engine tracks temporary hit points',
        'An enemy dies only when the engine reports it.',
        // canon
        'USE THESE EXACT NAMES',
        'When introducing an NPC from the list, use their EXACT name',
      ]) {
        expect(text, guard).toContain(guard);
      }
    }
  });
});
