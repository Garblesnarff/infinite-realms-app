/**
 * #570: the Combat Summary after a WIN.
 *
 * Hark's N2-014 row: the fight was won, the end line posted, and no Combat
 * Summary panel ever appeared. The summary is client-posted: the deferred
 * summary hook (wired here exactly as GameContent wires it — real
 * CombatProvider, real MessageProvider and message queue) queues it when
 * `isInCombat` flips, then posts it when this fight's terminal DM message
 * lands, or after the bounded fallback when none does. The numbers come from
 * `GET /v1/combat/:encounterId/damage-summary`, aggregated server-side from
 * combat_damage_log.
 *
 * Real: CombatProvider + authoritative sync, MessageProvider + queue,
 * useDeferredCombatSummary. Stubbed: `fetch` for the combat reads and the
 * damage summary, and `userDataApi` as an in-memory message store that
 * behaves like the server (a saved message is what history returns).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../../../shared/npc-engine-message';

import { CharacterProvider } from '@/contexts/CharacterContext';
import { CombatProvider, useCombat } from '@/contexts/CombatContext';
import { MessageProvider, useMessageContext } from '@/contexts/MessageContext';
import { useDeferredCombatSummary } from '@/features/game-session/hooks/use-deferred-combat-summary';
import { characterLoaderService } from '@/services/character-loader';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/character-loader', () => ({
  characterLoaderService: { loadCharacterWithSpells: vi.fn() },
}));
vi.mock('@/services/auth/TokenService', async (importOriginal) =>
  (await import('@/test/token-service-mock')).createTokenServiceMock(importOriginal, {
    getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer <redacted>' })),
    getAccessToken: vi.fn(() => 'test'),
  }),
);
vi.mock('@/hooks/use-session-story-socket', () => ({
  useSessionStorySocket: () => vi.fn(),
}));
vi.mock('@/webmcp/use-companion-scene', () => ({ useCompanionScene: () => ({ data: undefined }) }));
vi.mock('@/webmcp/companion-api', () => ({ getActiveCompanions: () => [] }));

const SESSION_ID = 'session-570';
const ENCOUNTER_ID = 'enc-570';
const HERO_ID = '11111111-1111-4111-8111-111111111111';
const GOBLIN_ID = '22222222-2222-4222-8222-222222222222';

const saveCalls: Array<{ sessionId: string; body: any }> = [];
const store: Array<any> = [];

let activeCombat: any = null;
let summaryRounds = 3;
const combatPayload = (round = 3) => ({
  encounter: {
    id: ENCOUNTER_ID,
    sessionId: SESSION_ID,
    status: 'active',
    currentRound: round,
    currentTurnOrder: 0,
    startedAt: '2026-10-20T00:00:00.000Z',
    endedAt: null,
  },
  participants: [
    {
      id: HERO_ID,
      characterId: 'hero-char-1',
      name: 'Hero',
      participantType: 'player',
      initiative: 15,
      initiativeModifier: 2,
      armorClass: 16,
      maxHp: 20,
      speed: 30,
      isActive: true,
      status: { currentHp: 14, maxHp: 20, tempHp: 0, isConscious: true },
    },
    {
      id: GOBLIN_ID,
      characterId: null,
      name: 'Goblin',
      participantType: 'monster',
      initiative: 10,
      initiativeModifier: 1,
      armorClass: 13,
      maxHp: 7,
      speed: 30,
      isActive: true,
      status: { currentHp: 7, maxHp: 7, tempHp: 0, isConscious: true },
    },
  ],
});

const captured: {
  refresh?: () => Promise<unknown>;
  sendMessage?: (m: any) => Promise<void>;
  messages: any[];
  isInCombat: boolean;
} = { messages: [], isInCombat: false };

const Probe: React.FC = () => {
  const { state, refreshCombatState } = useCombat();
  const { messages, sendMessage, isLoading } = useMessageContext();
  useDeferredCombatSummary({
    isInCombat: state.isInCombat,
    activeEncounter: state.activeEncounter,
    messages,
    messagesLoading: isLoading,
    sendMessage,
    onCombatEnded: () => undefined,
  });
  captured.refresh = refreshCombatState as () => Promise<unknown>;
  captured.sendMessage = sendMessage as (m: any) => Promise<void>;
  captured.messages = messages;
  captured.isInCombat = state.isInCombat;
  return null;
};

describe('combat summary after a win (#570)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    saveCalls.length = 0;
    store.length = 0;
    summaryRounds = 3;
    activeCombat = combatPayload();
    (characterLoaderService.loadCharacterWithSpells as any).mockResolvedValue({
      id: 'hero-char-1',
      name: 'Hero',
      level: 3,
      abilityScores: {},
      character_stats: [],
    });
    (userDataApi.listSessionMessages as any) = vi.fn().mockImplementation(async () => ({
      messages: store.map((row) => ({ ...row })),
      total: store.length,
    }));
    (userDataApi.saveSessionMessages as any) = vi.fn(async (sessionId: string, body: any) => {
      saveCalls.push({ sessionId, body });
      store.push({
        id: body.id,
        message: body.message,
        speaker_type: body.speaker_type,
        context: body.context,
        timestamp: body.timestamp,
        sequence_number: store.length + 1,
        game_sessions: null,
      });
      return { messages: [{ id: body.id, ...body }] };
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: any) => {
      const url = String(input);
      if (url.includes('/v1/combat/sessions/') && url.includes('/active')) {
        return { ok: true, status: 200, json: async () => ({ combat: activeCombat }), headers: new Headers() } as Response;
      }
      if (url.includes('/damage-summary')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            summary: {
              encounterId: ENCOUNTER_ID,
              rounds: summaryRounds,
              totalDamage: 13,
              participants: [
                { participantId: HERO_ID, name: 'Hero', damageDealt: 7, damageTaken: 6, status: 'ok' },
                { participantId: GOBLIN_ID, name: 'Goblin', damageDealt: 6, damageTaken: 7, status: 'dead' },
              ],
            },
          }),
          headers: new Headers(),
        } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}), headers: new Headers() } as Response;
    });
  });

  it('posts the combat summary after a win flip + terminal DM message', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CharacterProvider>
          <CombatProvider sessionId={SESSION_ID}>
            <MessageProvider sessionId={SESSION_ID}>
              <Probe />
            </MessageProvider>
          </CombatProvider>
        </CharacterProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(captured.isInCombat).toBe(true), { timeout: 15000 });

    // The killing blow lands server-side; the client pulls authoritative state.
    activeCombat = null;
    await act(async () => {
      await captured.refresh?.();
    });
    await waitFor(() => expect(captured.isInCombat).toBe(false), { timeout: 15000 });

    // The next DM turn's reply carries combatEnded (use-ai-response stamps it).
    await act(async () => {
        await captured.sendMessage?.({
        text: 'The goblin falls. The feast hall is quiet.',
        sender: 'dm',
        context: { combatEnded: true },
      } as any);
    });

    await waitFor(
      () => {
        const summarySave = saveCalls.find((c) => c.body?.context?.combatData?.summary);
        expect(summarySave).toBeTruthy();
        expect(summarySave?.body.context.combatData.summary.totalDamage).toBe(13);
      },
      { timeout: 30000 },
    );

    await waitFor(() => {
      const inList = captured.messages.find((m) => m.context?.combatData?.summary);
      expect(inList).toBeTruthy();
    });
  }, 90000);

  it('posts the summary on the fallback timer when no DM turn follows', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CharacterProvider>
          <CombatProvider sessionId={SESSION_ID}>
            <MessageProvider sessionId={SESSION_ID}>
              <Probe />
            </MessageProvider>
          </CombatProvider>
        </CharacterProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(captured.isInCombat).toBe(true), { timeout: 15000 });
    activeCombat = null;
    await act(async () => {
      await captured.refresh?.();
    });
    await waitFor(() => expect(captured.isInCombat).toBe(false), { timeout: 15000 });

    await waitFor(
      () => {
        const summarySave = saveCalls.find((c) => c.body?.context?.combatData?.summary);
        expect(summarySave).toBeTruthy();
      },
      { timeout: 30000 },
    );
  }, 60000);

  it('posts the summary promptly for a 7-round win the server ended (#976)', async () => {
    summaryRounds = 7;
    activeCombat = combatPayload(7);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CharacterProvider>
          <CombatProvider sessionId={SESSION_ID}>
            <MessageProvider sessionId={SESSION_ID}>
              <Probe />
            </MessageProvider>
          </CombatProvider>
        </CharacterProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(captured.isInCombat).toBe(true), { timeout: 15000 });

    // The killing blow lands through the combat intent endpoint (round 7). The
    // server concludes the encounter, writes the actor's terminal engine row
    // (buildNpcEngineMessage is the real producer; writeNpcEngineRow stores it
    // with npcResult + combatEncounterId added), and the client merges the row
    // from the intent response's engineRows via the session-engine-rows event —
    // exactly the production delivery. No DM turn runs, so no DM message ever
    // carries combatEnded for this fight.
    const killResult = {
      actorName: 'Hero',
      targetName: 'Goblin',
      hit: true,
      finalDamage: 7,
      targetNewHp: 0,
      targetIsConscious: false,
      combatEnded: true,
      endedReason: 'last_hostile_defeated',
    };
    const built = buildNpcEngineMessage(
      [
        { id: HERO_ID, name: 'Hero', participantType: 'player', maxHp: 20 },
        { id: GOBLIN_ID, name: 'Goblin', participantType: 'monster', maxHp: 7 },
      ],
      7,
      { type: 'attack', actorId: HERO_ID, targetIds: [GOBLIN_ID] },
      killResult,
    );
    expect(built.text).toContain('Combat ended');
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('session-engine-rows', {
          detail: [
            {
              id: 'row-kill-976',
              sessionId: SESSION_ID,
              sequence: 42,
              text: built.text,
              timestamp: new Date().toISOString(),
              context: {
                ...built.context,
                npcResult: killResult,
                combatEncounterId: ENCOUNTER_ID,
                actionId: 'kill-976',
              },
            },
          ],
        }),
      );
    });
    await waitFor(() =>
      expect(captured.messages.some((m) => m.text.includes('Combat ended'))).toBe(true),
    );

    // The client pulls authoritative state: the fight is over.
    activeCombat = null;
    await act(async () => {
      await captured.refresh?.();
    });
    await waitFor(() => expect(captured.isInCombat).toBe(false), { timeout: 15000 });

    // The summary must release on the terminal row — well inside the 15 s
    // fallback window the bug hid behind.
    await waitFor(
      () => {
        const summarySave = saveCalls.find((c) => c.body?.context?.combatData?.summary);
        expect(summarySave).toBeTruthy();
        expect(summarySave?.body.context.combatData.summary.rounds).toBe(7);
        expect(summarySave?.body.context.combatData.summary.totalDamage).toBe(13);
      },
      { timeout: 8000 },
    );
  }, 90000);
});
