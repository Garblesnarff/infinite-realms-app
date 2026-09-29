/* eslint-disable @typescript-eslint/no-explicit-any */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import { buildSpellCastMessage } from '@/features/game-session/components/game/overhaul/spell-view-model';
import { AIService } from '@/services/ai-service';
import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import { repairRefusedCombatAction } from '@/services/combat/combat-repair';
import { userDataApi } from '@/services/user-data-api';

/**
 * Run M7 round 4 (#2304), from the sheet's Cast button to the text the player reads.
 *
 * The handler, the resolution step, the area-spell executor, and the transcript formatter are
 * all real. Only the network edge is stubbed, and the tactical route's answers below are the
 * ones `server-bun/src/routes/v1/__tests__/aoe-cast-player-spell-http.test.ts` pins against the
 * real route and the real spell resolution (same board, same dice).
 */

vi.mock('@/services/ai-service', () => ({ AIService: { chatWithDM: vi.fn() } }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-action-executor', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  executeStructuredCombatActionWithBoundary: vi.fn(),
  executeAuthoritativeCombatIntent: vi.fn(),
}));
vi.mock('@/services/combat/combat-repair', () => ({ repairRefusedCombatAction: vi.fn() }));
// The spell-attack popup: the player lets the engine roll. Its own flow is covered elsewhere.
vi.mock('@/services/combat/player-spell-cast', () => ({
  askPlayerForSpellCast: vi.fn().mockResolvedValue({ autoRolled: true }),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    resolveAoECast: vi.fn(),
    advanceNpcTurns: vi.fn(),
  },
}));

const APPRENTICE_ID = '1bc3932f-da2d-4525-84e5-77a31a4b3bef';
const GOLDWHISK_ID = '779792b2-aef0-4288-be43-19aba2530eba';
const PARTICIPANTS = [
  { id: APPRENTICE_ID, name: 'The Apprentice', participantType: 'player', turnOrder: 1 },
  { id: GOLDWHISK_ID, name: 'Headmaster Goldwhisk', participantType: 'monster', turnOrder: 2 },
];
const ENCOUNTER = {
  id: 'encounter-m7',
  phase: 'active',
  participants: PARTICIPANTS,
  currentRound: 4,
};

/** Exactly what the sheet's Cast button sends for Burning Hands at level 1. */
const SHEET_CAST = buildSpellCastMessage({ name: 'Burning Hands', id: 'burning-hands', level: 1 });

/** The DM's declaration in round 4: an area spell, the caster named by its digest slug. */
const DM_AOE_ACTION = {
  actor_id: 'the-apprentice',
  action_type: 'cast_spell',
  spell_id: 'burning-hands',
  origin: { x: 3, y: 4 },
  direction: null,
  slot_level: 1,
};
/** Round 4's first-pass prose — the acid and the blow the player never saw happen. */
const DM_PROSE =
  'Your glob of acidic energy splashes harmlessly against the floor. The blow catches you across the ribs.';

const jsonResponse = (status: number, body: unknown) =>
  ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

/** The route's success answer for the cone that caught Goldwhisk (d20 11, 3d6 = 12). */
const RESOLVED = {
  delta: {
    type: 'aoe_cast',
    actorId: APPRENTICE_ID,
    spellId: 'burning-hands',
    targets: [{ entityId: GOLDWHISK_ID, saved: false, finalDamage: 12, newHp: 28 }],
    forcedMoves: [],
  },
  result: {
    results: [
      {
        spellName: 'Burning Hands',
        actorName: 'The Apprentice',
        targetName: 'Headmaster Goldwhisk',
        saveAbility: 'dexterity',
        saveRoll: 11,
        saveDC: 13,
        saved: false,
        hit: true,
        damageType: 'fire',
        finalDamage: 12,
        targetNewHp: 28,
      },
    ],
  },
};
/** The production refusal from round 4 (53-byte body), as the fixed route now words it. */
const REFUSED = {
  error:
    "the caster 'the-apprentice' is not on the tactical map (on the map: headmaster-goldwhisk@3,4)",
  details: { reason: 'caster_not_on_map' },
};

const invoke = (overrides: Record<string, unknown> = {}): Promise<any> =>
  handleDmActionsAndTransitions({
    sessionId: 'session-m7',
    characterRecord: { id: 'char-1' },
    activeEncounter: ENCOUNTER,
    isInCombat: true,
    refreshCombatState: vi.fn().mockResolvedValue(ENCOUNTER),
    aiContext: { gameState: {} },
    conversationHistory: [],
    playerMessage: SHEET_CAST,
    // The sheet's Cast button: this turn's player input (#2305).
    playerInputOrigin: 'sheet_cast',
    result: { text: DM_PROSE, combat_actions: [DM_AOE_ACTION] },
    ...overrides,
  } as any);

/** The narration pass: the last chatWithDM call, its payload and the setup line it was given. */
const narrationCall = () => {
  const calls = vi.mocked(AIService.chatWithDM).mock.calls;
  const [params] = calls[calls.length - 1] as any[];
  const history = params.conversationHistory as Array<{ content: string }>;
  return { payload: JSON.parse(params.message), setup: history[history.length - 1].content };
};

const playerEngineLines = (outcome: any): string[] =>
  (outcome.result.combatEngineBlocks ?? [])
    .filter((block: any) => block.source === 'player')
    .flatMap((block: any) => block.lines);

describe('the sheet-Cast Burning Hands at level 1 (#2304)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'Flame roars from your hands.',
    } as any);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: { id: GOLDWHISK_ID, name: 'Headmaster Goldwhisk' },
    });
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({
      results: [],
      transcriptLines: [],
      currentParticipant: { id: APPRENTICE_ID, name: 'The Apprentice' },
    } as any);
    vi.mocked(repairRefusedCombatAction).mockResolvedValue(null as any);
  });

  it('is cast by the engine once and printed as one line: DEX save, fire damage', async () => {
    vi.mocked(userDataApi.resolveAoECast).mockResolvedValue(jsonResponse(200, RESOLVED));

    const outcome = await invoke();

    expect(userDataApi.resolveAoECast).toHaveBeenCalledTimes(1);
    expect(userDataApi.resolveAoECast).toHaveBeenCalledWith('session-m7', {
      phase: 'propose',
      actorId: 'the-apprentice',
      spellId: 'burning-hands',
      origin: { x: 3, y: 4 },
      direction: null,
      slotLevel: 1,
      // Forwarded to the intent gateway, which acts for the player only on player input.
      actionOrigin: 'sheet_cast',
    });
    const lines = playerEngineLines(outcome);
    expect(lines).toEqual([
      '⚙️ Engine: The Apprentice cast Burning Hands at Headmaster Goldwhisk — DEX save 11 vs DC 13 — FAIL. 12 fire damage. Headmaster Goldwhisk is now at 28 HP.',
    ]);
    expect(outcome.responseText.startsWith(lines[0])).toBe(true);
    // The turn ends like any other resolved action, and the monsters take theirs.
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
      'encounter-m7',
      { type: 'end_turn', actorId: APPRENTICE_ID },
      'dm',
    );
    expect(userDataApi.advanceNpcTurns).toHaveBeenCalledTimes(1);
    const { payload } = narrationCall();
    expect(payload.authoritativeCombatResults).toHaveLength(1);
    expect(payload.authoritativeCombatResults[0].action).toMatchObject({
      actor_id: APPRENTICE_ID,
      spell_id: 'burning-hands',
      target_ids: [GOLDWHISK_ID],
    });
    expect(payload.unresolvedPlayerAction).toBeUndefined();
    // The targeted path is not also taken: one cast, not two.
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
  });

  it('ends a refusal in one engine line with the reason, tells the DM so, and returns the turn', async () => {
    vi.mocked(userDataApi.resolveAoECast).mockResolvedValue(jsonResponse(422, REFUSED));

    const outcome = await invoke();

    const lines = playerEngineLines(outcome);
    expect(lines).toEqual([
      `⚙️ Engine: The Apprentice's spell "Burning Hands" was refused (${REFUSED.error}). No roll, no damage, no wound.`,
    ]);
    // Nothing resolved, so nothing ended the turn and no monster acted.
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(userDataApi.advanceNpcTurns).not.toHaveBeenCalled();
    const { payload, setup } = narrationCall();
    expect(payload.unresolvedPlayerAction).toContain(
      "The Apprentice's Burning Hands was NOT resolved by the engine",
    );
    expect(payload.unresolvedPlayerAction).toContain('Do not narrate its effect');
    expect(payload.unresolvedPlayerAction).toContain("It is still The Apprentice's turn.");
    expect(payload.currentTurn).toBe('The Apprentice');
    expect(payload.turnHandoff).toBe('End your response with: "The Apprentice, what do you do?"');
    // The acid-and-blow prose is not handed back as the setup of the narration.
    expect(setup).not.toContain('acidic');
    expect(setup).toContain('refused by the engine and is void');
    expect(outcome.responseText).toContain('it is still your turn');
    expect(outcome.responseText.trimEnd().endsWith('The Apprentice, what do you do?')).toBe(true);
  });

  it('keeps exactly one engine line when a retry casts it after the area was refused', async () => {
    // Refused out of turn with a stale NPC turn in front of the player: the NPC turn is settled
    // and the same area spell is cast again, as the player's own input.
    vi.mocked(userDataApi.resolveAoECast)
      .mockResolvedValueOnce(
        jsonResponse(422, {
          error: 'Actor is not the current-turn participant',
          details: { currentParticipantId: GOLDWHISK_ID },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(200, RESOLVED));

    const outcome = await invoke();

    expect(userDataApi.resolveAoECast).toHaveBeenCalledTimes(2);
    const lines = playerEngineLines(outcome);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('DEX save 11 vs DC 13 — FAIL. 12 fire damage.');
    expect(narrationCall().payload.unresolvedPlayerAction).toBeUndefined();
  });

  it('withholds an area spell the repair invents for the player, and keeps the refusal line', async () => {
    vi.mocked(userDataApi.resolveAoECast).mockResolvedValue(jsonResponse(422, REFUSED));
    // The DM's repair re-declares the area. That is the DM's input, not the player's (#2305).
    vi.mocked(repairRefusedCombatAction).mockResolvedValue({
      combat_actions: [{ ...DM_AOE_ACTION, actor_id: APPRENTICE_ID }],
    } as any);

    const outcome = await invoke();

    expect(userDataApi.resolveAoECast).toHaveBeenCalledTimes(1);
    const lines = playerEngineLines(outcome);
    expect(lines).toEqual([
      `⚙️ Engine: The Apprentice's spell "Burning Hands" was refused (${REFUSED.error}). No roll, no damage, no wound.`,
    ]);
    const { payload } = narrationCall();
    expect(payload.withheldPlayerActions).toEqual([
      expect.objectContaining({ actor: 'The Apprentice', action: 'cast_spell', source: 'repair' }),
    ]);
    expect(payload.unresolvedPlayerAction).toContain(
      "The Apprentice's Burning Hands was NOT resolved",
    );
  });

  it('says it was not resolved when the DM declared no action for it at all', async () => {
    // The DM answers with prose only, and the zero-action repair gets prose only too.
    vi.mocked(AIService.chatWithDM).mockResolvedValue({
      text: 'still prose',
      combat_actions: [],
    } as any);

    const outcome = await invoke({ result: { text: DM_PROSE, combat_actions: [] } });

    expect(userDataApi.resolveAoECast).not.toHaveBeenCalled();
    const lines = playerEngineLines(outcome);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^⚙️ Engine: The Apprentice's spell "Burning Hands" was refused \(the DM did not declare it as a combat action/,
    );
    expect(narrationCall().payload.unresolvedPlayerAction).toContain(
      "The Apprentice's Burning Hands was NOT resolved",
    );
    expect(outcome.responseText.trimEnd().endsWith('The Apprentice, what do you do?')).toBe(true);
  });

  it('names Burning Hands as not cast when the DM casts Chill Touch in its place', async () => {
    const chillTouch = {
      actor_id: APPRENTICE_ID,
      action_type: 'cast_spell',
      target_ids: [GOLDWHISK_ID],
      weapon_id: null,
      spell_id: 'chill_touch',
      slot_level: null,
      movement_feet: 0,
    };
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [],
      boundary: null,
      result: {
        spellName: 'Chill Touch',
        actorName: 'The Apprentice',
        targetName: 'Headmaster Goldwhisk',
        d20: 15,
        attackBonus: 5,
        totalAttackRoll: 20,
        targetAC: 12,
        hit: true,
        finalDamage: 5,
        damageType: 'necrotic',
      },
    });

    const outcome = await invoke({ result: { text: DM_PROSE, combat_actions: [chillTouch] } });

    const lines = playerEngineLines(outcome);
    // The substitute resolved and is reported as what it was; the declared spell is not silent.
    expect(lines.some((line) => line.includes('cast Chill Touch'))).toBe(true);
    const refused = lines.filter((line) => line.includes('was refused'));
    expect(refused).toEqual([
      '⚙️ Engine: The Apprentice\'s spell "Burning Hands" was refused (the DM declared Chill Touch instead, so the engine never cast it — cast it again and name your target). No roll, no damage, no wound.',
    ]);
    expect(narrationCall().payload.unresolvedPlayerAction).toContain(
      "The Apprentice's Burning Hands was NOT resolved",
    );
  });

  it('counts a differently spelled id of the declared spell as that spell', async () => {
    vi.mocked(userDataApi.resolveAoECast).mockResolvedValue(jsonResponse(200, RESOLVED));

    const outcome = await invoke({
      result: { text: DM_PROSE, combat_actions: [{ ...DM_AOE_ACTION, spell_id: 'Burning_Hands' }] },
    });

    expect(playerEngineLines(outcome).filter((line) => line.includes('was refused'))).toEqual([]);
  });

  it('reports an area waiting for the map confirmation as waiting, not as refused', async () => {
    // A non-Self area: the route places it and answers with the preview, not a cast.
    vi.mocked(userDataApi.resolveAoECast).mockResolvedValue(
      jsonResponse(200, {
        preview: { type: 'aoe_preview', state: 'player-pending', actorId: APPRENTICE_ID },
        autoConfirm: false,
        hostile: false,
      }),
    );

    const outcome = await invoke({
      playerMessage: 'I hurl a fireball at the headmaster',
      result: { text: DM_PROSE, combat_actions: [{ ...DM_AOE_ACTION, spell_id: 'fireball' }] },
    });

    expect(playerEngineLines(outcome)).toEqual([
      "⚙️ Engine: The Apprentice's Fireball is placed on the tactical map and waits for you — confirm the spell area there to cast it. Nothing has been rolled yet.",
    ]);
    expect(repairRefusedCombatAction).not.toHaveBeenCalled();
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    const { payload, setup } = narrationCall();
    expect(payload.refusedActions).toBeUndefined();
    expect(payload.unresolvedPlayerAction).toBeUndefined();
    expect(payload.pendingPlayerAction).toContain(
      "The Apprentice's Fireball is placed on the map but NOT cast",
    );
    expect(payload.pendingPlayerAction).toContain("It is still The Apprentice's turn.");
    expect(setup).not.toContain('acidic');
    expect(outcome.responseText).not.toContain('refused');
    expect(outcome.responseText.trimEnd().endsWith('The Apprentice, what do you do?')).toBe(true);
  });
});
