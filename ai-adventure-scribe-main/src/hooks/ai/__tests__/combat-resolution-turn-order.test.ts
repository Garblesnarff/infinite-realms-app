/* eslint-disable max-lines */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../shared/npc-engine-message';
import {
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  PLAYER_HITS_ENEMY,
  PLAYER_SPELL_ATTACK_HITS,
  REEVES,
  SCHOLAR,
} from '../../../../shared/test-fixtures/engine-results';

import type { CombatEngineBlock } from '@/utils/combat-engine-blocks';

import { useMessages } from '@/hooks/use-messages';
import { markAuthReady } from '@/lib/auth-gate';
import { setPlayerRollHost } from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';
import { combatEngineBlocksFromContext } from '@/utils/combat-engine-blocks';

/**
 * #263 turn-order half (strategist Required #2 on PR #600): the proving test.
 *
 * A player attack whose movement is spent settles through the real client settle path
 * (`resolveDeclaredCombatActions` -> `settleExecutedAction` -> `crossTurnBoundary`), and the
 * transcript must read: the player's result row, then "ended their turn", then the enemy
 * rows — the CB-024 / N2-034 order. Everything from the resolution step through the real
 * executor (`executeStructuredCombatActionWithBoundary`, `executeAuthoritativeCombatIntent`,
 * including its `session-engine-rows` dispatch) is real; only the network edge is stubbed,
 * with the answers the real route gives. Row texts are built by the real producer,
 * `buildNpcEngineMessage` (`shared/npc-engine-message.ts`, the same writer the server's
 * `writeNpcEngineRow` calls); the attack results copy the full output of
 * `CombatAttackService.resolveAttack` + `exposeAttackVisibility`
 * (`shared/test-fixtures/engine-results.ts`), fields included that the mappers always set.
 *
 * The final order assertion goes through the REAL use-messages ordering: the settled reply
 * (with its combatEngineBlocks and a producer-shaped sequenceNumber) and the dispatched
 * session-engine-rows are fed through `useMessages` (renderHook), which merges them with
 * the real `compareMessages` (sequenceNumber). The test does not concatenate arrays itself.
 */
const chatWithDM = vi.fn();
const repairRefusedCombatAction = vi.fn();
const fetchMock = vi.fn();

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: (...args: any[]) => chatWithDM(...args) },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-repair', () => ({
  repairRefusedCombatAction: (...args: any[]) => repairRefusedCombatAction(...args),
}));
vi.mock('@/services/combat/player-movement-remaining', () => ({
  actorMovementRemaining: vi.fn().mockResolvedValue(0),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listSessionMessages: vi.fn(),
    saveSessionMessages: vi.fn(),
  },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const ENCOUNTER_ID = 'enc-263';
const SESSION_ID = 'session-263';

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

/** `proposeCombatAttack`'s whole return for The Scholar's longsword swing at Reeves. */
const LONGSWORD_PROPOSAL = {
  movementOnly: false,
  weaponName: 'Longsword',
  attackBonus: 4,
  targetAc: 13,
  advantage: false,
  disadvantage: false,
  targetLabel: 'Captain Sarah Reeves',
};

/** `proposeAuthoritativeSpell`'s whole return for The Scholar's Chill Touch at Reeves. */
const CHILL_TOUCH_PROPOSAL = {
  movementOnly: false,
  spellId: 'chill-touch',
  spellName: 'Chill Touch',
  kind: 'attack',
  attackBonus: 6,
  saveDC: 13,
  targetAc: 13,
  advantage: false,
  disadvantage: false,
  targetLabel: 'Captain Sarah Reeves',
};

/** What the DM writes for a typed longsword attack by The Scholar at Captain Sarah Reeves. */
const dmAttackAction = {
  actor_id: SCHOLAR.id,
  action_type: 'attack' as const,
  target_ids: [REEVES.id],
  weapon_id: 'longsword',
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

/** What the DM writes for a typed Chill Touch by The Scholar at Captain Sarah Reeves. */
const dmSpellAction = {
  actor_id: SCHOLAR.id,
  action_type: 'cast_spell' as const,
  target_ids: [REEVES.id],
  weapon_id: null,
  spell_id: 'chill-touch',
  slot_level: 0,
  movement_feet: 0,
};

/**
 * The server rows for the boundary, built by the real row-text producer with the same
 * participants the resolution step sees. `writeNpcEngineRow` wraps these in the
 * `{ id, sequence, text, kind, actionId, sessionId, timestamp, context }` envelope; the
 * envelope fields are server-assigned, so the test only needs their order.
 */
const rowEnvelope = (text: string, context: unknown, sequence: number, kind: 'npc' | 'player') => ({
  id: `row-${sequence}`,
  sequence,
  text,
  kind,
  actionId: `action-${sequence}`,
  sessionId: SESSION_ID,
  timestamp: new Date().toISOString(),
  context,
});

const boundaryMessage = buildNpcEngineMessage(
  FIGHT_ROSTER,
  1,
  { type: 'end_turn', actorId: SCHOLAR.id },
  {},
);
const enemyMessage = buildNpcEngineMessage(
  FIGHT_ROSTER,
  1,
  { type: 'attack', actorId: REEVES.id, targetId: SCHOLAR.id },
  ENEMY_HITS_PLAYER,
);
const BOUNDARY_ROW = rowEnvelope(boundaryMessage.text, boundaryMessage.context, 11, 'player');
const ENEMY_ROW = rowEnvelope(enemyMessage.text, enemyMessage.context, 12, 'npc');

/** The `npcTurns` drain as the end_turn route returns it (`AdvanceNpcTurnsResponse` shape). */
const NPC_TURNS = {
  results: [
    {
      action: {
        actor_id: REEVES.id,
        action_type: 'attack',
        target_ids: [SCHOLAR.id],
        weapon_id: null,
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      round: 1,
      engineResult: ENEMY_HITS_PLAYER,
      outcomes: [],
      actorIsPlayer: false,
      transcriptLines: [],
    },
  ],
  currentParticipant: { id: SCHOLAR.id, name: SCHOLAR.name, participantType: 'player' },
  round: 1,
  combatEnded: false,
  iterationCount: 1,
  iterationCap: 4,
  capReached: false,
  transcriptLines: [],
  engineRows: [],
};

const resolve = (combatActions: unknown[], declarationText: string) =>
  resolveDeclaredCombatActions({
    encounterId: ENCOUNTER_ID,
    sessionId: SESSION_ID,
    combatActions,
    declarationText,
    aiContext: {},
    conversationHistory: [],
    participants: FIGHT_ROSTER,
    playerInputOrigin: 'typed',
  } as any);

const createQueryClient = (): QueryClient =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });

const Wrapper = ({ children }: { children: React.ReactNode }): React.ReactElement => {
  const client = React.useMemo(() => createQueryClient(), []);
  return React.createElement(QueryClientProvider, { client }, children);
};

/**
 * Feed the settled reply and the dispatched rows through the REAL use-messages ordering.
 *
 * The reply's sequenceNumber is producer-shaped: the server assigns sequences in the order
 * messages are written. The `timeline` records the settle's actual commit order —
 * `appendEngineBlock` (which builds the reply's blocks) runs before the movement check,
 * which runs before `crossTurnBoundary` (which writes the rows). If the blocks were built
 * before the rows were written, the reply sorts before them (sequence 10 < 11); if a
 * production mutation moved the boundary ahead of the block commit, the reply sorts after
 * (sequence 13 > 12) and the order assertion goes red.
 */
const orderThroughUseMessages = async (
  replyText: string,
  blocks: CombatEngineBlock[],
  timeline: string[],
  rows: Array<{ id: string; sequence: number; text: string; timestamp: string; context: unknown }>,
) => {
  const blocksFirst = timeline[0] === 'movement-check';
  const replySequence = blocksFirst ? 10 : 13;
  // Snapshot the rows: the `collectRows` listener is still attached and would double-count
  // the manual dispatch below.
  const rowsSnapshot = rows.map((row) => ({ ...row }));
  vi.mocked(userDataApi.listSessionMessages).mockResolvedValue({
    messages: [
      {
        id: 'dm-reply-1',
        message: replyText,
        speaker_type: 'dm',
        timestamp: new Date().toISOString(),
        sequence_number: replySequence,
        context: { combatEngineBlocks: blocks },
        game_sessions: { characters: null },
      },
    ],
    total: 1,
    hasMore: false,
  });
  const { result } = renderHook(() => useMessages(SESSION_ID), { wrapper: Wrapper });
  await waitFor(() => expect(result.current.data).toHaveLength(1));
  act(() => {
    window.dispatchEvent(
      new CustomEvent('session-engine-rows', {
        detail: rowsSnapshot.map((row) => ({
          id: row.id,
          sessionId: SESSION_ID,
          sequence: row.sequence,
          text: row.text,
          timestamp: row.timestamp,
          context: row.context,
        })),
      }),
    );
  });
  await waitFor(() => expect(result.current.data).toHaveLength(1 + rowsSnapshot.length));
  return result.current.data;
};

describe('the turn-order transcript of a settled player attack (#263)', () => {
  const rollPrompts: unknown[] = [];
  const dispatchedRows: Array<{ id: string; sequence: number; text: string; timestamp: string; context: unknown }> = [];
  /**
   * Temporal order of the settle's two commits. `appendEngineBlock` is synchronous in
   * `settleExecutedAction`, ahead of the awaited movement check; the end_turn fetch is
   * recorded when the stub sees it. `['movement-check', 'end_turn-sent']` proves the
   * player's result row was committed before the boundary was crossed.
   */
  const timeline: string[] = [];

  const collectRows = (event: Event): void => {
    for (const row of (event as CustomEvent<Array<{ id?: string; sequence?: number; text?: string; timestamp?: string; context?: unknown }>>).detail ?? []) {
      if (row.text) {
        dispatchedRows.push({
          id: row.id ?? `row-${row.sequence}`,
          sequence: row.sequence ?? 0,
          text: row.text,
          timestamp: row.timestamp ?? new Date().toISOString(),
          context: row.context,
        });
      }
    }
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    rollPrompts.length = 0;
    dispatchedRows.length = 0;
    timeline.length = 0;
    const { actorMovementRemaining } = await import('@/services/combat/player-movement-remaining');
    vi.mocked(actorMovementRemaining).mockImplementation(async () => {
      timeline.push('movement-check');
      return 0;
    });
    // The player rolls a natural 14 the moment the prompt appears.
    setPlayerRollHost({
      present: (spec, settle) => {
        rollPrompts.push(spec);
        settle({ d20: 14 });
        return { rollId: 'roll-1', dismiss: () => {} };
      },
    });
    vi.stubGlobal('fetch', fetchMock);
    // The roll-result log (`SessionStateService.appendRollEvent`, #467) runs for real: the
    // auth gate starts closed in tests, so open it, and answer the session-state calls.
    markAuthReady();
    fetchMock.mockImplementation(async (url: unknown, init: any) => {
      const urlString = String(url);
      if (urlString.includes('/v1/sessions/')) {
        if (init?.method === 'PATCH') return jsonResponse(200, {});
        return jsonResponse(200, { session_state: null });
      }
      const body = JSON.parse(String(init.body));
      if (body.phase === 'propose') {
        if (body.intent?.type === 'spell')
          return jsonResponse(200, { accepted: true, proposal: CHILL_TOUCH_PROPOSAL });
        return jsonResponse(200, { accepted: true, proposal: LONGSWORD_PROPOSAL });
      }
      // The real route returns `{ accepted, result, engineRows }`; the client reads
      // `payload.result`. A player's attack writes no dialogue row server-side
      // (`writesEngineRow` is false for it), so its result carries no `engineRows`.
      if (body.intent.type === 'attack')
        return jsonResponse(200, { accepted: true, result: PLAYER_HITS_ENEMY, engineRows: [] });
      if (body.intent.type === 'spell')
        return jsonResponse(200, { accepted: true, result: PLAYER_SPELL_ATTACK_HITS, engineRows: [] });
      if (body.intent.type === 'end_turn') {
        timeline.push('end_turn-sent');
        return jsonResponse(200, {
          accepted: true,
          result: {
            currentParticipant: { id: REEVES.id, name: REEVES.name },
            engineRows: [BOUNDARY_ROW, ENEMY_ROW],
            npcTurns: NPC_TURNS,
            sessionId: SESSION_ID,
          },
          engineRows: [BOUNDARY_ROW, ENEMY_ROW],
        });
      }
      throw new Error(`unexpected intent ${body.intent.type}`);
    });
    chatWithDM.mockResolvedValue({ text: 'The cold steel finds its mark.', narrationSegments: [] });
    repairRefusedCombatAction.mockResolvedValue(null);
    window.addEventListener('session-engine-rows', collectRows);
  });

  afterEach(() => {
    window.removeEventListener('session-engine-rows', collectRows);
  });

  it('reads attack, then the player result row, then "ended their turn", then the enemy rows', async () => {
    const result = await resolve([dmAttackAction], 'I attack Captain Sarah Reeves with my longsword.');

    // The player threw their own die through the real prompt.
    expect(rollPrompts).toHaveLength(1);

    // The player's result row, rendered by the real outcome mapper.
    const engineLines = (result.combatEngineBlocks as CombatEngineBlock[]).flatMap(
      (block) => block.lines,
    );
    expect(engineLines).toHaveLength(1);
    expect(engineLines[0]).toContain('The Scholar rolled 14 + 4 = 18 vs AC 13');
    expect(engineLines[0]).toContain('HIT');

    // The attack resolved before the boundary was crossed: propose, commit, then end_turn.
    const intents = fetchMock.mock.calls
      .filter(([url]: any[]) => String(url).includes('/v1/combat/'))
      .map(([, init]: any[]) => {
        const body = JSON.parse(String(init.body));
        return body.phase === 'propose' ? 'propose' : body.intent.type;
      });
    expect(intents).toEqual(['propose', 'attack', 'end_turn']);

    // The player's result row was committed before the boundary was crossed: the movement
    // check runs after `appendEngineBlock` and before `crossTurnBoundary` in the settle.
    expect(timeline).toEqual(['movement-check', 'end_turn-sent']);

    // The server rows dispatch in the order the server wrote them: the boundary row that
    // `writeNpcEngineRow` stored for the keyed end_turn, then the drained enemy row.
    expect(dispatchedRows.map((row) => row.text)).toEqual([BOUNDARY_ROW.text, ENEMY_ROW.text]);
    expect(BOUNDARY_ROW.text).toContain('The Scholar ended their turn');
    expect(ENEMY_ROW.text).toContain('Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11');

    // The whole client transcript in order, through the REAL use-messages merge: the
    // settled reply (carrying the player's result in its combatEngineBlocks) sorts before
    // the boundary and enemy rows by the real `compareMessages` (sequenceNumber).
    const ordered = await orderThroughUseMessages(
      'The cold steel finds its mark.',
      result.combatEngineBlocks as CombatEngineBlock[],
      timeline,
      dispatchedRows,
    );
    expect(ordered).toHaveLength(3);
    // The reply carries the player's result in its blocks.
    const replyBlocks = combatEngineBlocksFromContext(ordered[0].context as Record<string, unknown>);
    expect(replyBlocks).toHaveLength(1);
    expect(replyBlocks[0].lines[0]).toContain('The Scholar rolled 14 + 4 = 18 vs AC 13');
    // Then "ended their turn", then the enemy rows — the CB-024 / N2-034 order.
    expect(ordered[1].text).toContain('The Scholar ended their turn');
    expect(ordered[2].text).toContain('Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11');
  });

  it('orders a settled Chill Touch before "ended their turn" and the enemy rows', async () => {
    const result = await resolve([dmSpellAction], 'I cast Chill Touch at Captain Sarah Reeves.');

    // The player threw their own die through the real prompt.
    expect(rollPrompts).toHaveLength(1);

    // The player's spell result row, rendered by the real outcome mapper.
    const engineLines = (result.combatEngineBlocks as CombatEngineBlock[]).flatMap(
      (block) => block.lines,
    );
    expect(engineLines).toHaveLength(1);
    expect(engineLines[0]).toContain('The Scholar');
    expect(engineLines[0]).toContain('Chill Touch');

    // The spell resolved before the boundary was crossed: propose, commit, then end_turn.
    const intents = fetchMock.mock.calls
      .filter(([url]: any[]) => String(url).includes('/v1/combat/'))
      .map(([, init]: any[]) => {
        const body = JSON.parse(String(init.body));
        return body.phase === 'propose' ? 'propose' : body.intent.type;
      });
    expect(intents).toEqual(['propose', 'spell', 'end_turn']);

    // The player's result row was committed before the boundary was crossed.
    expect(timeline).toEqual(['movement-check', 'end_turn-sent']);

    // The whole client transcript in order, through the REAL use-messages merge.
    const ordered = await orderThroughUseMessages(
      'The grave-chill takes hold.',
      result.combatEngineBlocks as CombatEngineBlock[],
      timeline,
      dispatchedRows,
    );
    expect(ordered).toHaveLength(3);
    const replyBlocks = combatEngineBlocksFromContext(ordered[0].context as Record<string, unknown>);
    expect(replyBlocks).toHaveLength(1);
    expect(replyBlocks[0].lines[0]).toContain('Chill Touch');
    expect(ordered[1].text).toContain('The Scholar ended their turn');
    expect(ordered[2].text).toContain('Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11');
  });
});
