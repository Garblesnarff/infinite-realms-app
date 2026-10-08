/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  cantripAoECastWireBody,
  dmCantripAoEAction,
} from '../../../../shared/test-fixtures/cantrip-aoe-cast';
import {
  UNSEATED_TARGET_TOKEN,
  unresolvedTargetRefusalBody,
} from '../../../../shared/test-fixtures/unresolved-target-refusal';
import { turnNotice } from '../combat-notice';

import type * as PlayerAttackRoll from '@/services/combat/player-attack-roll';

import { setSpellTargetSaveHost } from '@/services/combat/spell-target-save-bridge';

/**
 * Run M10 (#2438): the player typed "I cast Acid Splash at the Bitter End Mercenary" while the
 * engine had the enemy seated under another name, so the typed name matched no combatant.
 *
 * What the player must get back is a reply that says so and leaves the turn theirs, never "I
 * encountered an issue processing your message". The refusal is produced by the real executor
 * from the body the real intent route sends for an unseated target
 * (`shared/test-fixtures/unresolved-target-refusal.ts`, asserted against the route in
 * `slug-actor-intent-http.test.ts`), and the AoE-shaped cantrip is the body the DM declared in
 * M10 (`dmCantripAoEAction`, refused by the route as `no_area_of_effect`). Only the network edge
 * and the LLM are stubbed.
 */
const chatWithDM = vi.fn();
const repairRefusedCombatAction = vi.fn();
const askPlayerForAttackDie = vi.fn();
const resolveAoECast = vi.fn();
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
vi.mock('@/services/combat/player-attack-roll', async (importOriginal) => ({
  ...(await importOriginal<typeof PlayerAttackRoll>()),
  askPlayerForAttackDie: (...args: any[]) => askPlayerForAttackDie(...args),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    resolveAoECast: (...args: any[]) => resolveAoECast(...args),
  },
}));

const { resolveDeclaredCombatActions } = await import('../combat-resolution-step');

const APPRENTICE_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const MERCENARY_ID = '3e0f4c1a-7d52-4b8e-9a61-0c2d5e7f8a90';
const PARTICIPANTS = [
  { id: APPRENTICE_ID, name: 'The Apprentice', participantType: 'player' },
  { id: MERCENARY_ID, name: 'Bitter End Mercenary', participantType: 'monster' },
];
const ROSTER = 'the-apprentice@3,4, bitter-end-mercenary@8,4';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const declared = (
  actionType: 'attack' | 'cast_spell',
  overrides: Record<string, unknown> = {},
) => ({
  actor_id: 'the-apprentice',
  action_type: actionType,
  target_ids: [UNSEATED_TARGET_TOKEN],
  weapon_id: null,
  spell_id: actionType === 'cast_spell' ? 'acid-splash' : null,
  slot_level: null,
  movement_feet: 0,
  ...overrides,
});

const run = (combatActions: unknown[]) =>
  resolveDeclaredCombatActions({
    encounterId: '18b7f4d6-57c1-4fe5-a9ed-17e1127dc16e',
    sessionId: '35fd47e5-416d-4e79-be3b-f594beaa4a1f',
    combatActions,
    declarationText: 'I cast Acid Splash at the Sour Knight.',
    aiContext: { gameState: { isInCombat: true } },
    conversationHistory: [],
    participants: PARTICIPANTS,
    playerInputOrigin: 'typed',
  });

const engineLines = (result: any): string[] =>
  (result.combatEngineBlocks ?? []).flatMap((block: any) => block.lines);

describe('a typed target that matches no combatant (#2438)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    setSpellTargetSaveHost({
      present: (_spec, settle) => {
        settle();
        return () => {};
      },
    });
    askPlayerForAttackDie.mockResolvedValue({ dismissed: false, value: { autoRolled: true } });
    chatWithDM.mockResolvedValue({ text: 'Nothing moves.', narrationSegments: [] });
  });

  it('typed attack: the DM cannot repair the target, and the player is told, not errored', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, unresolvedTargetRefusalBody('attack', ROSTER)));
    // The repair regeneration came back as prose with no combat_actions: the shape that used to
    // end in `throw error` and the "Processing Error" notification.
    repairRefusedCombatAction.mockResolvedValue({ text: 'The Sour Knight is nowhere to be seen.' });

    const result = await run([declared('attack')]);

    expect(result.text).toContain('No creature by that name is in this fight');
    expect(result.text).toContain('Who do you mean: Bitter End Mercenary?');
    expect(result.text).toContain('it is still your turn');
    const payload = JSON.parse(chatWithDM.mock.calls[0][0].message);
    expect(payload.refusedActions[0]).toMatchObject({
      actorIsPlayer: true,
      action: 'attack',
      refusalReason: 'COMBAT_INTENT_UNRESOLVED_TARGET',
    });
    expect(payload.authoritativeCombatResults).toEqual([]);
  });

  it('typed attack with no repair at all gets the same answer', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, unresolvedTargetRefusalBody('attack', ROSTER)));
    repairRefusedCombatAction.mockResolvedValue(null);

    const result = await run([declared('attack')]);

    expect(result.text).toContain('No creature by that name is in this fight');
  });

  it('typed single-target cast: the engine line says no creature by that name is here', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, unresolvedTargetRefusalBody('spell', ROSTER)));
    repairRefusedCombatAction.mockResolvedValue(null);

    const result = await run([declared('cast_spell')]);

    expect(engineLines(result).join('\n')).toContain(
      'no creature by that name is in this fight — name one of the creatures on the board',
    );
    expect(result.text).toContain('No creature by that name is in this fight');
  });

  it('after NPC pre-flight handed the turn to the player, the notice is still the target notice', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, unresolvedTargetRefusalBody('attack', ROSTER)));
    repairRefusedCombatAction.mockResolvedValue(null);

    const result = await resolveDeclaredCombatActions({
      encounterId: '18b7f4d6-57c1-4fe5-a9ed-17e1127dc16e',
      sessionId: '35fd47e5-416d-4e79-be3b-f594beaa4a1f',
      combatActions: [declared('attack')],
      declarationText: 'I attack the Sour Knight.',
      aiContext: { gameState: { isInCombat: true } },
      conversationHistory: [],
      participants: PARTICIPANTS,
      playerInputOrigin: 'typed',
      // The mercenary acted first; the turn came back to the player before they typed.
      preResolvedNpcTurns: {
        results: [],
        currentParticipant: PARTICIPANTS[0],
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached: false,
        transcriptLines: [],
      } as any,
    });

    expect(result.text).toContain('No creature by that name is in this fight');
    expect(result.text).not.toContain('out of turn');
  });

  describe('when creatures already acted in this reply (#2444)', () => {
    /**
     * The server drain's shape (npc-turn-runner AdvanceNpcTurnsResult; per-result transcriptLines
     * are always empty since #2658 step 2, and the top level holds only a cap line): the mercenary
     * struck first.
     */
    const preflight = (currentParticipant: (typeof PARTICIPANTS)[number], capReached: boolean) =>
      ({
        results: [
          {
            action: {
              actor_id: MERCENARY_ID,
              action_type: 'attack',
              target_ids: [APPRENTICE_ID],
              weapon_id: null,
              spell_id: null,
              slot_level: null,
              movement_feet: 0,
            },
            round: 1,
            outcomes: [{ participantId: APPRENTICE_ID, finalDamage: 5, hit: true }],
            actorIsPlayer: false,
            transcriptLines: [],
          },
        ],
        currentParticipant,
        round: 1,
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 4,
        capReached,
        transcriptLines: capReached
          ? [
              '⚙️ Engine: NPC turn loop stopped after 4 iterations; the encounter remains paused for safety.',
            ]
          : [],
        engineRows: [],
      }) as any;
    const runAfterPreflight = (response: any) =>
      resolveDeclaredCombatActions({
        encounterId: '18b7f4d6-57c1-4fe5-a9ed-17e1127dc16e',
        sessionId: '35fd47e5-416d-4e79-be3b-f594beaa4a1f',
        combatActions: [declared('attack')],
        declarationText: 'I attack the Sour Knight.',
        aiContext: { gameState: { isInCombat: true } },
        conversationHistory: [],
        participants: PARTICIPANTS,
        playerInputOrigin: 'typed',
        preResolvedNpcTurns: response,
      });

    it("does not say nothing was resolved, though the turn is the player's", async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, unresolvedTargetRefusalBody('attack', ROSTER)));
      repairRefusedCombatAction.mockResolvedValue(null);

      const result = await runAfterPreflight(preflight(PARTICIPANTS[0], false));

      expect(result.text).toContain(
        'No creature by that name is in this fight, so that action was not resolved',
      );
      expect(result.text).toContain('it is your turn.');
      expect(result.text).toContain('Who do you mean: Bitter End Mercenary?');
      expect(result.text).not.toContain('nothing was resolved');
      expect(result.text).not.toContain('still your turn');
    });

    it("does not say it is still the player's turn when a creature holds it", async () => {
      fetchMock.mockResolvedValue(jsonResponse(404, unresolvedTargetRefusalBody('attack', ROSTER)));
      repairRefusedCombatAction.mockResolvedValue(null);

      const result = await runAfterPreflight(preflight(PARTICIPANTS[1], true));

      expect(result.text).toContain(
        'No creature by that name is in this fight, so that action was not resolved',
      );
      expect(result.text).toContain(turnNotice(PARTICIPANTS[1], false));
      expect(result.text).toContain("it is Bitter End Mercenary's turn");
      expect(result.text).not.toContain('nothing was resolved');
      expect(result.text).not.toContain('still your turn');
    });
  });

  it("a creature's own unresolved target ends only its action, not the turn", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, unresolvedTargetRefusalBody('attack', ROSTER)));
    repairRefusedCombatAction.mockResolvedValue(null);

    const result = await run([declared('attack', { actor_id: 'bitter-end-mercenary' })]);

    expect(result.text).toContain('Nothing moves.');
    expect(result.text).not.toContain('No creature by that name');
  });

  it('M10: the AoE-shaped Acid Splash the route refuses is reported, not thrown', async () => {
    resolveAoECast.mockResolvedValue(
      jsonResponse(422, {
        error: 'Acid Splash has no area of effect — name its target and cast it again',
        details: { reason: 'no_area_of_effect' },
      }),
    );
    repairRefusedCombatAction.mockResolvedValue({ text: 'The acid hisses.' });

    const result = await run([dmCantripAoEAction]);

    expect(resolveAoECast).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        actionOrigin: 'typed',
        slotLevel: cantripAoECastWireBody.slotLevel,
      }),
    );
    expect(engineLines(result).join('\n')).toContain('Acid Splash has no area of effect');
    expect(result.text).toContain('still your turn');
  });
});
