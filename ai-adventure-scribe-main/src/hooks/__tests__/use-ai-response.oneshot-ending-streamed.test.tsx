/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1084 (Hark V-001): a one-shot's ending reply, on the STREAMED path, must
 * reach the end-state screen with the run's XP.
 *
 * The reply is the route's real output (`shared/test-fixtures/oneshot-ending-reply.ts`,
 * pinned to `rewriteNarrationSegmentsFromEnvelope` by the server test
 * `oneshot-ending-reply.fixture.test.ts`). It travels the real client chain:
 * the SSE `done` event through `llmApiClient.generateText` (rest-client), the
 * reply mapper `processDMResponse` (dm-response-processor), the completion
 * latch in `useAIResponse`, and the shared end state the live game screen
 * renders (`CampaignCompleteEndState`, no `experience` prop — as
 * GameMainContent's live wrapper passes it). On main the mapper dropped
 * `campaign_ending`, so the latch never fired (#1089's latch test mocked
 * `chatWithDM` and never saw the drop), and the live end state showed no XP.
 * No DM/LLM call is made: fetch is stubbed with the fixture.
 */
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ONESHOT_ENDING_DONE_PAYLOAD,
  ONESHOT_ENDING_SUMMARY,
} from '../../../shared/test-fixtures/oneshot-ending-reply';
import { useAIResponse } from '../use-ai-response';

import { CampaignCompleteEndState } from '@/features/game-session/components/game/game-content/CompletionScreen';
import { llmApiClient } from '@/infrastructure/api/rest-client';
import { processDMResponse } from '@/services/ai/dm-response-processor';
import { userDataApi } from '@/services/user-data-api';

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
const RUN_XP = 1500;
// #1161: the mocked sheet starts at the PRE-award total and lands the run XP
// only when the test simulates the award-triggered refresh (holder swap +
// rerender). A constant 1500 object would model a sheet that never refreshes,
// which the #1161 wait-for-refresh screen correctly holds hidden.
const { sheetHolder } = vi.hoisted(() => ({
  sheetHolder: { current: { experience: 1175 } },
}));

vi.mock('@/lib/auth-gate', () => ({
  waitForAuth: vi.fn(() => Promise.resolve()),
  markAuthReady: vi.fn(),
  resetAuthGate: vi.fn(),
  isAuthVerified: vi.fn(() => true),
}));

vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test-token' })),
  loadCachedSession: vi.fn(() => ({ access_token: 'test-token', refresh_token: 'r' })),
  persistSession: vi.fn(),
  refreshAccessTokenOnce: vi.fn(),
  TokenRefreshTransportError: class TokenRefreshTransportError extends Error {},
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: vi.fn(() => ({ userPlan: 'pro' })),
}));

vi.mock('@/contexts/CombatContext', () => ({
  useCombat: vi.fn(() => ({
    state: { isInCombat: false, activeEncounter: null },
    refreshCombatState: vi.fn(async () => null),
  })),
}));

vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'exploration', diceRollQueue: { pendingRolls: [] } },
    setGamePhase: vi.fn(),
  })),
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character: null } }),
  // The live end state reads the sheet from here; the object identity
  // changes only when the award-triggered refresh lands (#1161).
  useOptionalCharacter: () => ({ state: { character: sheetHolder.current } }),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    clearPendingCombatIntent: vi.fn(),
    fetchSessionFallenState: vi.fn(),
  },
}));

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
}));

vi.mock('@/services/memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/hooks/ai/roll-processor', () => ({
  processRollRequests: vi.fn().mockResolvedValue({
    playerRollRequests: [],
    npcRollResults: [],
    npcRollContinuationText: '',
  }),
}));

vi.mock('@/hooks/ai/session-logger', () => ({
  logIncomingRolls: vi.fn().mockResolvedValue(undefined),
  logRollRequests: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const sseResponse = (events: Array<Record<string, unknown>>) =>
  new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  });

describe('one-shot ending on the streamed path reaches the end-state screen (#1084)', () => {
  const sessionId = 'session-1084-streamed';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: sessionId,
      campaign_id: 'camp-1',
      character_id: 'char-1',
      campaign: { id: 'camp-1', name: 'Camp' },
      character: { id: 'char-1', name: 'Char' },
    } as any);
    vi.mocked(userDataApi.fetchSessionFallenState).mockResolvedValue(null);
  });

  it('latches the stored ending and shows the screen with the run XP', async () => {
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        { type: 'delta', text: 'The last coin settles in the ledger, ' },
        { type: 'delta', text: 'and the wish closes around you like a door.' },
        { type: 'done', payload: ONESHOT_ENDING_DONE_PAYLOAD },
      ]),
    );
    const chunks: string[] = [];
    const rawResponse = await llmApiClient.generateText({
      prompt: 'I pay the last coin.',
      sessionId,
      onStream: (chunk) => chunks.push(chunk),
    });
    expect(chunks.length).toBeGreaterThan(0);

    const mapped = await processDMResponse({
      rawResponse,
      context: { sessionId, gameState: { isInCombat: false } } as any,
      message: 'I pay the last coin.',
      conversationHistory: [],
      voiceContext: null,
      isFirstMessage: false,
      deferSideEffects: true,
    } as any);
    expect(mapped.campaign_ending).toEqual({ summary: ONESHOT_ENDING_SUMMARY });

    const { AIService } = await import('@/services/ai-service');
    vi.mocked(AIService.chatWithDM).mockResolvedValue(mapped as any);
    const { result } = renderHook(() => useAIResponse());
    await act(async () => {
      await result.current.getAIResponse(
        [
          { text: 'I pay the last coin.', sender: 'player', timestamp: new Date().toISOString() },
        ] as any,
        sessionId,
      );
    });
    await waitFor(() =>
      expect(result.current.campaignCompletedState).toMatchObject({
        summary: ONESHOT_ENDING_SUMMARY,
        sessionId,
      }),
    );

    const summary = result.current.campaignCompletedState!.summary;
    const { rerender } = render(
      <MemoryRouter>
        <CampaignCompleteEndState
          summary={summary}
          chooseHeroHref="/app/characters"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { name: /adventure complete/i })).toBeInTheDocument();
    expect(screen.getByText(ONESHOT_ENDING_SUMMARY)).toBeInTheDocument();
    // #1161: before the award-triggered refresh lands, the live path holds
    // the XP line rather than showing the pre-award total.
    expect(screen.queryByTestId('completion-screen-experience')).not.toBeInTheDocument();
    // Simulate the sheet refresh landing (the #1130 hook's SET_CHARACTER).
    sheetHolder.current = { experience: RUN_XP };
    rerender(
      <MemoryRouter>
        <CampaignCompleteEndState
          summary={summary}
          chooseHeroHref="/app/characters"
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('completion-screen-experience')).toHaveTextContent(
      `${RUN_XP.toLocaleString()} XP`,
    );
  });
});
