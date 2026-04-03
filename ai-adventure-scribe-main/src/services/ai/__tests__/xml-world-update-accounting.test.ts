/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Regression tests for XML world-update accounting vs DB write outcomes.
 *
 * Bead: ai-adventure-scribe-main-dl2
 *
 * Guards against false-positive "world expanded" logging where the success
 * summary drifts from actual committed DB writes. All three acceptance criteria:
 *   1. Partial failure → success counts exclude the failed write
 *   2. Warning emitted with correct failure ratio/count
 *   3. No "world expanded" success log when no entities were actually saved
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are initialised before the vi.mock() factories run
const { mockSaveNPC, mockSaveLocation, mockSaveQuest, mockLogger } = vi.hoisted(() => ({
  mockSaveNPC: vi.fn<[], Promise<boolean>>(),
  mockSaveLocation: vi.fn<[], Promise<boolean>>(),
  mockSaveQuest: vi.fn<[], Promise<boolean>>(),
  mockLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/services/world-builders', () => ({
  WorldBuilderRepository: {
    saveNPCFromXML: mockSaveNPC,
    saveLocationFromXML: mockSaveLocation,
    saveQuestFromXML: mockSaveQuest,
  },
  WorldBuilderService: {
    respondToPlayerAction: vi.fn().mockResolvedValue({ npcs: [], locations: [], quests: [] }),
  },
}));

vi.mock('@/lib/logger', () => ({ default: mockLogger }));

vi.mock('../memory-manager', () => ({
  MemoryManager: {
    saveMemories: vi.fn().mockResolvedValue(undefined),
    extractMemories: vi.fn().mockResolvedValue({ memories: [] }),
  },
}));

vi.mock('../voice-consistency-service', () => ({
  voiceConsistencyService: { getVoiceContext: vi.fn() },
}));

vi.mock('../asset-processor', () => ({
  applyAssetPostProcessing: vi.fn((input: any) => input),
  insertAssetTags: vi.fn((text: string) => text),
  getCachedAssets: vi.fn(() => []),
}));

vi.mock('../shared/verbalized-sampling', () => ({
  sampleFromVerbalizedResponse: vi.fn((text: string) => text),
}));

// ── Import SUT after mocks ────────────────────────────────────────────────────
import { processDMResponse } from '../dm-response-processor';

import type { CombatDetectionResult } from '@/utils/combatDetection';

// ── Shared test fixtures ──────────────────────────────────────────────────────

const BASE_CONTEXT = {
  campaignId: 'campaign-123',
  sessionId: 'session-456',
  characterId: 'char-789',
  userId: 'user-000',
};

const NO_COMBAT: CombatDetectionResult = {
  isCombat: false,
  combatType: 'none',
  confidence: 0,
  shouldStartCombat: false,
  shouldEndCombat: false,
};

/**
 * Build a rawResponse string that contains valid world_updates XML.
 */
function buildRawResponse(opts: {
  npcs?: Array<{ name: string; description: string; location: string }>;
  locations?: Array<{ name: string; description: string; status: string }>;
  quests?: Array<{ name: string; update: string }>;
}): string {
  const lines: string[] = [];
  for (const n of opts.npcs ?? []) {
    lines.push(`- npc: ${n.name} | ${n.description} | ${n.location}`);
  }
  for (const l of opts.locations ?? []) {
    lines.push(`- location: ${l.name} | ${l.description} | ${l.status}`);
  }
  for (const q of opts.quests ?? []) {
    lines.push(`- quest: ${q.name} | ${q.update}`);
  }

  return `The adventure continues.\n\n<world_updates>\n${lines.join('\n')}\n</world_updates>`;
}

async function callProcessor(rawResponse: string) {
  return processDMResponse({
    rawResponse,
    context: BASE_CONTEXT,
    message: 'What do I see?',
    conversationHistory: [],
    userPlan: 'free',
    turnCount: 2,
    voiceContext: null, // bypasses JSON-parsing branch
    isFirstMessage: false,
    combatDetection: NO_COMBAT,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('XML world-update accounting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('partial failure (regression core)', () => {
    it('success log reflects only committed writes; warning includes failure ratio', async () => {
      // 3 attempted: NPC ✓, location ✗, quest ✓ → 2 succeed, 1 fails
      mockSaveNPC.mockResolvedValue(true);
      mockSaveLocation.mockResolvedValue(false);
      mockSaveQuest.mockResolvedValue(true);

      const raw = buildRawResponse({
        npcs: [{ name: 'Gareth', description: 'A blacksmith', location: 'Ironhold' }],
        locations: [{ name: 'Ironhold', description: 'A mining town', status: 'thriving' }],
        quests: [{ name: 'The Missing Ore', update: 'Ore shipment delayed' }],
      });

      await callProcessor(raw);

      // AC-1: Success log counts exclude the failed location
      const infoMessages = mockLogger.info.mock.calls.map((c: any[]) => c[0] as string);
      const expandLog = infoMessages.find((m: string) => m.includes('🌍 World expanded'));
      expect(expandLog).toBeDefined();
      expect(expandLog).toContain('+0 locations');
      expect(expandLog).toContain('+1 NPCs');
      expect(expandLog).toContain('+1 quests');

      // AC-2: Warning emitted with correct failure ratio
      const warnMessages = mockLogger.warn.mock.calls.map((c: any[]) => c[0] as string);
      const failLog = warnMessages.find((m: string) => m.includes('XML world updates failed'));
      expect(failLog).toBeDefined();
      expect(failLog).toContain('1/3');

      // AC-3: Success log does not claim the failed location was saved
      expect(expandLog).not.toContain('+1 locations');
    });
  });

  describe('all saves fail', () => {
    it('suppresses success log and emits full-failure warning', async () => {
      mockSaveNPC.mockResolvedValue(false);
      mockSaveLocation.mockResolvedValue(false);

      const raw = buildRawResponse({
        npcs: [{ name: 'Mira', description: 'A healer', location: 'Ashfield' }],
        locations: [{ name: 'Ashfield', description: 'A quiet village', status: 'peaceful' }],
      });

      await callProcessor(raw);

      // No "🌍 World expanded" when total=0
      const expandLog = mockLogger.info.mock.calls
        .map((c: any[]) => c[0] as string)
        .find((m: string) => m.includes('🌍 World expanded'));
      expect(expandLog).toBeUndefined();

      // Warning shows 2/2 failed
      const warnMessages = mockLogger.warn.mock.calls.map((c: any[]) => c[0] as string);
      const failLog = warnMessages.find((m: string) => m.includes('XML world updates failed'));
      expect(failLog).toBeDefined();
      expect(failLog).toContain('2/2');
    });
  });

  describe('all saves succeed', () => {
    it('logs full expansion counts and emits no failure warning', async () => {
      mockSaveNPC.mockResolvedValue(true);
      mockSaveQuest.mockResolvedValue(true);

      const raw = buildRawResponse({
        npcs: [{ name: 'Torvin', description: 'A ranger', location: 'Deepwood' }],
        quests: [{ name: 'Hunt the Beast', update: 'Beast spotted near the ridge' }],
      });

      await callProcessor(raw);

      // Success log present with correct entity counts
      const infoMessages = mockLogger.info.mock.calls.map((c: any[]) => c[0] as string);
      const expandLog = infoMessages.find((m: string) => m.includes('🌍 World expanded'));
      expect(expandLog).toBeDefined();
      expect(expandLog).toContain('+1 NPCs');
      expect(expandLog).toContain('+1 quests');
      expect(expandLog).toContain('+0 locations');

      // No failure warning
      const warnMessages = mockLogger.warn.mock.calls.map((c: any[]) => c[0] as string);
      const failLog = warnMessages.find((m: string) => m.includes('XML world updates failed'));
      expect(failLog).toBeUndefined();
    });
  });

  describe('no XML tags in response', () => {
    it('does not invoke any save method and emits no expansion log', async () => {
      const raw = 'The tavern is quiet tonight. No signs of adventure yet.';

      await callProcessor(raw);

      expect(mockSaveNPC).not.toHaveBeenCalled();
      expect(mockSaveLocation).not.toHaveBeenCalled();
      expect(mockSaveQuest).not.toHaveBeenCalled();

      const expandLog = mockLogger.info.mock.calls
        .map((c: any[]) => c[0] as string)
        .find((m: string) => m.includes('🌍 World expanded'));
      expect(expandLog).toBeUndefined();
    });
  });
});
