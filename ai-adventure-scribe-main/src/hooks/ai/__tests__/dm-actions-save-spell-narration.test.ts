/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDmActionsAndTransitions } from '../dm-actions-handler';

import { buildSpellCastMessage } from '@/features/game-session/components/game/overhaul/spell-view-model';
import { AIService } from '@/services/ai-service';
import { setSpellTargetSaveHost } from '@/services/combat/spell-target-save-bridge';
import { userDataApi } from '@/services/user-data-api';

/**
 * Run 16 turn 7 (#2391): the sheet's Cast for Acid Splash at Captain Sarah Reeves. The engine
 * said DEX save 6 vs DC 14, FAIL, 2 acid damage, 9 HP. The DM wrote that the spell "fizzles".
 *
 * The handler, the resolution step, the real executor (its outcome mapper included) and the
 * transcript formatter run for real. Only the network edge is stubbed: `fetch` answers the
 * intent route with the body `combat-attack-service` builds for a save spell, and the first-pass
 * DM reply has the shape `processDMResponse` always returns (`combat_transition: 'none'` and every
 * other always-set field).
 */

vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/services/combat/combat-repair', () => ({
  repairRefusedCombatAction: vi.fn().mockResolvedValue(null),
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

const SCHOLAR_ID = '6f0d2b8e-1c4a-4d7e-9a53-2b1f0c9d8e71';
const REEVES_ID = 'b4c7a1e2-5d3f-4a8b-8c90-7e6d5f4a3b21';
const PARTICIPANTS = [
  { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player', turnOrder: 1 },
  { id: REEVES_ID, name: 'Captain Sarah Reeves', participantType: 'monster', turnOrder: 2 },
];
const ENCOUNTER = {
  id: 'encounter-run16',
  phase: 'active',
  participants: PARTICIPANTS,
  currentRound: 2,
};

const SHEET_CAST = buildSpellCastMessage({ name: 'Acid Splash', id: 'acid-splash', level: 0 });

/** The DM's first pass, in the envelope `processDMResponse` builds on every reply. */
const dmFirstPass = (): Record<string, unknown> => ({
  text: 'You flick your wrist and a bead of acid arcs toward the captain.',
  options: undefined,
  roll_requests: [],
  dice_rolls: [],
  combat_transition: 'none',
  scene_spec: null,
  combat_entry: undefined,
  combat_entry_pending: undefined,
  map_actions: [],
  handout_actions: [],
  combat_actions: [
    {
      actor_id: SCHOLAR_ID,
      action_type: 'cast_spell',
      target_ids: [REEVES_ID],
      weapon_id: null,
      spell_id: 'acid-splash',
      slot_level: null,
      movement_feet: 0,
    },
  ],
  combatants: [],
  combatDetection: {
    isCombat: true,
    confidence: 1,
    combatType: 'none',
    shouldStartCombat: false,
    shouldEndCombat: false,
    enemies: [],
    combatActions: [],
  },
});

/** The server's save-spell result: every field `combat-attack-service` sets, attack-shaped ones included. */
const saveSpellResult = (overrides: Record<string, unknown> = {}): unknown => ({
  results: [
    {
      hit: true,
      targetAC: 0,
      totalAttackRoll: 6,
      damage: 2,
      damageType: 'acid',
      damageBeforeResistances: 2,
      effectiveResistance: false,
      effectiveVulnerability: false,
      effectiveImmunity: false,
      finalDamage: 2,
      targetNewHp: 9,
      targetIsConscious: true,
      targetIsDead: false,
      targetCondition: 'wounded',
      isCritical: false,
      isNaturalOne: false,
      isNaturalTwenty: false,
      spellName: 'Acid Splash',
      saveAbility: 'dexterity',
      saveRoll: 6,
      saveDC: 14,
      saved: false,
      ...overrides,
    },
  ],
});

/** The intent route: the spell answers with `result`, the turn boundary with the next holder. */
const stubIntentRoute = (spellResult: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const intent = JSON.parse(String(init?.body)).intent;
      const result =
        intent.type === 'spell'
          ? spellResult
          : { currentParticipant: { id: REEVES_ID, name: 'Captain Sarah Reeves' } };
      return { ok: true, status: 200, headers: new Headers(), json: async () => ({ result }) };
    }),
  );
};

const invoke = (overrides: Record<string, unknown> = {}): Promise<any> =>
  handleDmActionsAndTransitions({
    sessionId: 'a249d586-a0ef-4089-ae48-566007cdd353',
    characterRecord: { id: 'char-1' },
    activeEncounter: ENCOUNTER,
    isInCombat: true,
    refreshCombatState: vi.fn().mockResolvedValue(ENCOUNTER),
    aiContext: { gameState: { isInCombat: true } },
    conversationHistory: [],
    playerMessage: SHEET_CAST,
    playerInputOrigin: 'sheet_cast',
    result: dmFirstPass(),
    ...overrides,
  } as any);

const narrationPayload = (): any => {
  const calls = vi.mocked(AIService.chatWithDM).mock.calls;
  return JSON.parse((calls[calls.length - 1][0] as any).message);
};

describe('the sheet-Cast Acid Splash narration pass (#2391)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setSpellTargetSaveHost({
      present: (_spec, settle) => {
        settle();
        return () => {};
      },
    });
    vi.mocked(AIService.chatWithDM).mockResolvedValue({ text: 'The acid burns.' } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({
      results: [],
      transcriptLines: [],
      currentParticipant: { id: SCHOLAR_ID, name: 'The Scholar' },
      combatEnded: false,
      iterationCount: 0,
      iterationCap: 4,
      capReached: false,
    } as any);
  });

  afterEach(() => {
    setSpellTargetSaveHost(null);
    vi.unstubAllGlobals();
  });

  it('hands the DM the failed save as a fact to restate, in the words of the engine line', async () => {
    stubIntentRoute(saveSpellResult());

    const outcome = await invoke();

    const engineLine =
      '⚙️ Engine: The Scholar cast Acid Splash at Captain Sarah Reeves — DEX save 6 vs DC 14 — FAIL. 2 acid damage. Captain Sarah Reeves is now at 9 HP.';
    expect(outcome.responseText.startsWith(engineLine)).toBe(true);

    const payload = narrationPayload();
    expect(payload.authoritativeCombatResults).toHaveLength(1);
    const [entry] = payload.authoritativeCombatResults;
    expect(entry.engineFact).toContain('Acid Splash is a saving-throw spell');
    expect(entry.engineFact).toContain('rolled a DEX save of 6 against DC 14');
    expect(entry.engineFact).toContain('Captain Sarah Reeves FAILED the save');
    expect(entry.engineFact).toContain('2 acid damage');
    expect(entry.engineFact).toContain('Captain Sarah Reeves is now at 9 HP');
    expect(payload.authoritativeCombatResultsNote).toContain(
      'not a fizzle, a miss, or "no effect"',
    );
  });

  it('sends no attack hit/miss wording for the save spell', async () => {
    stubIntentRoute(saveSpellResult());

    await invoke();

    const [entry] = narrationPayload().authoritativeCombatResults;
    const wire = JSON.stringify(entry);
    for (const field of ['"hit"', 'totalAttackRoll', 'targetAC', 'isCritical', 'autoRolled']) {
      expect(wire).not.toContain(field);
    }
    expect(entry.outcomes).toEqual([
      {
        participantId: REEVES_ID,
        newHp: 9,
        damageType: 'acid',
        finalDamage: 2,
        saved: false,
      },
    ]);
  });

  it('tells the narration pass that a save spell has no roll to request', async () => {
    stubIntentRoute(saveSpellResult());

    await invoke();

    const note = narrationPayload().authoritativeCombatResultsNote;
    expect(note).toContain('target has already rolled its save, so request no roll for it');
    expect(note).toContain('return no roll_requests');
    expect(narrationPayload().droppedRollRequests).toBeUndefined();
  });

  it('hands the DM a passed save as no effect, with no damage and no hit', async () => {
    stubIntentRoute(
      saveSpellResult({
        hit: false,
        saved: true,
        saveRoll: 17,
        totalAttackRoll: 17,
        finalDamage: 0,
        targetNewHp: 11,
        targetCondition: 'unharmed',
      }),
    );

    const outcome = await invoke();

    expect(outcome.responseText).toContain('DEX save 17 vs DC 14 — PASS.');
    const [entry] = narrationPayload().authoritativeCombatResults;
    expect(entry.engineFact).toContain('Captain Sarah Reeves PASSED the save');
    expect(entry.engineFact).toContain("avoids the spell's effect: no damage");
    expect(entry.engineFact).not.toContain('FAILED');
    expect(entry.outcomes[0]).toMatchObject({ saved: true, finalDamage: 0 });
  });
});
