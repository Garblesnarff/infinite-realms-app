/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../shared/npc-engine-message';
import {
  ENEMY_HITS_PLAYER,
  FIGHT_ROSTER,
  PLAYER_HITS_ENEMY,
  REEVES,
  SCHOLAR,
} from '../../../../shared/test-fixtures/engine-results';

import type { CombatEngineBlock } from '@/utils/combat-engine-blocks';

import { markAuthReady } from '@/lib/auth-gate';
import { setPlayerRollHost } from '@/services/combat/player-roll-bridge';

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

const resolve = (combatActions: unknown[]) =>
  resolveDeclaredCombatActions({
    encounterId: ENCOUNTER_ID,
    sessionId: SESSION_ID,
    combatActions,
    declarationText: 'I attack Captain Sarah Reeves with my longsword.',
    aiContext: {},
    conversationHistory: [],
    participants: FIGHT_ROSTER,
    playerInputOrigin: 'typed',
  } as any);

describe('the turn-order transcript of a settled player attack (#263)', () => {
  const rollPrompts: unknown[] = [];
  const dispatchedRows: Array<{ text: string }> = [];
  /**
   * Temporal order of the settle's two commits. `appendEngineBlock` is synchronous in
   * `settleExecutedAction`, ahead of the awaited movement check; the end_turn fetch is
   * recorded when the stub sees it. `['movement-check', 'end_turn-sent']` proves the
   * player's result row was committed before the boundary was crossed.
   */
  const timeline: string[] = [];

  const collectRows = (event: Event): void => {
    for (const row of (event as CustomEvent<Array<{ text?: string }>>).detail ?? []) {
      if (row.text) dispatchedRows.push({ text: row.text });
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
      if (body.phase === 'propose')
        return jsonResponse(200, { accepted: true, proposal: LONGSWORD_PROPOSAL });
      // The real route returns `{ accepted, result, engineRows }`; the client reads
      // `payload.result`. A player's attack writes no dialogue row server-side
      // (`writesEngineRow` is false for it), so its result carries no `engineRows`.
      if (body.intent.type === 'attack')
        return jsonResponse(200, { accepted: true, result: PLAYER_HITS_ENEMY, engineRows: [] });
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
    const result = await resolve([dmAttackAction]);

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

    // The whole client transcript in order: player's result, boundary, enemy rows.
    const transcript = [...engineLines, ...dispatchedRows.map((row) => row.text)];
    expect(transcript[0]).toContain('The Scholar rolled 14 + 4 = 18 vs AC 13');
    expect(transcript[1]).toContain('The Scholar ended their turn');
    expect(transcript[2]).toContain('Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11');
  });
});
