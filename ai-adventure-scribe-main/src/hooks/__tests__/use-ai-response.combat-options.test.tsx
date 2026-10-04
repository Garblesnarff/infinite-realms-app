/* eslint-disable @typescript-eslint/no-explicit-any */
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DECLARED_ATTACK_SESSION_ID,
  declaredAttackCharacter,
} from '../../../shared/test-fixtures/declared-attack-hold';
import { useAIResponse } from '../use-ai-response';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { useCombat } from '@/contexts/CombatContext';
import { DynamicOptionsSection } from '@/features/game-session/components/chat/message-list/DynamicOptionsSection';
import { buildSpellCastMessage } from '@/features/game-session/components/game/overhaul/spell-view-model';
import { AIService } from '@/services/ai-service';
import { setPlayerRollHost } from '@/services/combat/player-roll-bridge';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/contexts/AuthContext', () => ({ useAuth: vi.fn(() => ({ userPlan: 'pro' })) }));
vi.mock('@/contexts/CombatContext', () => ({ useCombat: vi.fn() }));
vi.mock('@/contexts/GameContext', () => ({
  useGame: vi.fn(() => ({
    state: { currentPhase: 'combat', diceRollQueue: { pendingRolls: [] } },
    setGamePhase: vi.fn(),
  })),
}));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
  getAccessToken: vi.fn(() => 'test'),
}));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    getSessionContext: vi.fn(),
    getTacticalMapContext: vi.fn(),
    detectDeclaredAttack: vi.fn(),
    advanceNpcTurns: vi.fn(),
    endTacticalMap: vi.fn(),
    applyDmTacticalActions: vi.fn(),
    applyDmHandoutActions: vi.fn(),
    fetchSessionFallenState: vi.fn(),
  },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { chatWithDM: vi.fn(), lastRequestId: vi.fn() },
}));
vi.mock('@/services/combat/combat-zero-action-guard', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enforceCombatActionOnAttempt: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/memory-manager', () => ({
  MemoryManager: { getRelevantMemories: vi.fn().mockResolvedValue([]) },
}));
vi.mock('@/services/voice-consistency-service', () => ({
  voiceConsistencyService: {
    getSessionVoiceContext: vi.fn().mockResolvedValue({ knownCharacters: {} }),
    processVoiceAssignments: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/hooks/ai/game-phase-updater', () => ({
  updateGamePhase: vi.fn(),
  clampCombatIntentFlags: vi.fn((start, end) => ({
    shouldStartCombat: start,
    shouldEndCombat: end,
  })),
}));
vi.mock('@/hooks/ai/session-logger', () => ({
  logIncomingRolls: vi.fn().mockResolvedValue(undefined),
  logRollRequests: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const serverParticipants = [
  {
    id: 'emil-1',
    name: 'The Faceless Stalker',
    participantType: 'monster',
    turnOrder: 0,
    initiative: 12,
    initiativeModifier: 0,
    armorClass: 13,
    maxHp: 10,
    speed: 30,
    actionUsed: true,
    bonusActionUsed: false,
    reactionUsed: false,
    isActive: true,
    status: { currentHp: 10, maxHp: 10, tempHp: 0, isConscious: true },
    conditions: [],
  },
  {
    id: 'scholar-1',
    characterId: declaredAttackCharacter.id,
    name: 'The Scholar',
    participantType: 'player',
    turnOrder: 1,
    initiative: 3,
    initiativeModifier: 1,
    armorClass: 11,
    maxHp: 7,
    speed: 30,
    actionUsed: false,
    bonusActionUsed: false,
    reactionUsed: false,
    isActive: true,
    status: { currentHp: 4, maxHp: 7, tempHp: 0, isConscious: true },
    conditions: [],
  },
];
const encounterHeldBy = (participantId: string, currentRound = 1, playerActionUsed = false) =>
  mapAuthoritativeCombat({
    encounter: {
      id: 'enc-1',
      sessionId: DECLARED_ATTACK_SESSION_ID,
      status: 'active',
      currentRound,
      currentTurnOrder: serverParticipants.findIndex(
        (participant) => participant.id === participantId,
      ),
      startedAt: '2026-10-03T05:20:04.424Z',
      endedAt: null,
      pendingIntent: null,
    },
    participants: serverParticipants.map((participant) => ({
      ...participant,
      actionUsed:
        participant.participantType === 'player'
          ? playerActionUsed
          : currentRound > 1
            ? false
            : participant.actionUsed,
    })),
  });
const participants = encounterHeldBy('scholar-1').participants;

const noNpcTurns = {
  results: [],
  currentParticipant: { id: 'emil-1', name: 'Professor Emil Darkwater', participantType: 'npc' },
  combatEnded: false,
  iterationCount: 0,
  iterationCap: 4,
  capReached: false,
  transcriptLines: [],
};

/** The DM's structured declaration for the player's typed swing. */
const declaredSwing = {
  actor_id: 'scholar-1',
  action_type: 'attack',
  target_ids: ['emil-1'],
  weapon_id: null,
  spell_id: null,
  slot_level: null,
  movement_feet: 0,
};

/**
 * A last kill as the server sends it: `combat-attack-service` result fields (a dead target reads
 * `near death` from `healthConditionForCombat`), plus the `combatEnded: true` that
 * `combat-intent-service` adds.
 */
const killingBlow = {
  actorName: 'The Scholar',
  targetName: 'Professor Emil Darkwater',
  d20: 18,
  attackBonus: 5,
  totalAttackRoll: 23,
  targetAC: 12,
  hit: true,
  finalDamage: 9,
  damageType: 'bludgeoning',
  targetNewHp: 0,
  targetIsConscious: false,
  targetIsDead: true,
  targetCondition: 'near death',
  weaponResolution: { resolved: 'Quarterstaff', substituted: false },
  combatEnded: true,
};
// Envelope fields follow processDMResponse; legal actions follow getLegalCombatActions.
const envelope = (actions: unknown[] = []) => ({
  text: 'You prepare your staff.',
  combat_transition: 'none',
  combat_actions: actions,
  roll_requests: [],
  combatants: [],
  map_actions: [],
  handout_actions: [],
});

describe('D3: combat options use the real response hook (#2547)', () => {
  let held: string;
  let spent: boolean;
  let response: any;
  let refuse: boolean;
  let requests: any[];
  let proposals: any[];
  let advances: number;
  let round: number;
  let extraAction: { type: string; label: string } | undefined;
  let hintedAttack = false;
  let movementOnlyAttack = false;
  let moveDistanceFeet = 50;
  let moveRemainingFeet = 30;
  let moveDestination = { x: 6, y: 0 };
  let combatState: { isInCombat: boolean; activeEncounter: any };

  beforeEach(() => {
    vi.clearAllMocks();
    held = 'scholar-1';
    spent = false;
    refuse = false;
    response = undefined;
    requests = [];
    proposals = [];
    advances = 0;
    round = 1;
    extraAction = undefined;
    hintedAttack = false;
    movementOnlyAttack = false;
    moveDistanceFeet = 50;
    moveRemainingFeet = 30;
    moveDestination = { x: 6, y: 0 };
    combatState = { isInCombat: true, activeEncounter: encounterHeldBy(held, round, spent) };
    vi.mocked(useCombat).mockReturnValue({
      state: combatState,
      refreshCombatState: vi.fn(async () => {
        combatState.activeEncounter = encounterHeldBy(held, round, spent);
        return combatState.activeEncounter;
      }),
    } as any);
    vi.mocked(userDataApi.getSessionContext).mockResolvedValue({
      id: DECLARED_ATTACK_SESSION_ID,
      campaign_id: 'camp-1',
      character_id: declaredAttackCharacter.id,
      campaign: { id: 'camp-1' },
      character: declaredAttackCharacter,
    } as any);
    vi.mocked(userDataApi.getTacticalMapContext).mockResolvedValue({ ok: false } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockImplementation(async () => {
      advances++;
      round = 2;
      held = 'scholar-1';
      spent = false;
      return { ...noNpcTurns, currentParticipant: participants[1], currentRound: 2 } as any;
    });
    vi.mocked(AIService.chatWithDM)
      .mockResolvedValueOnce(envelope([declaredSwing]) as any)
      .mockResolvedValue({ ...envelope(), text: 'The creature watches you.' } as any);
    setPlayerRollHost({
      present: (_spec, settle) => {
        queueMicrotask(() => settle({ d20: 8 }));
        return { rollId: 'roll-attack', dismiss: () => {} };
      },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body ?? '{}'));
        const reply = (payload: unknown, status = 200) =>
          new Response(JSON.stringify(payload), { status });
        if (url.endsWith('/legal-actions'))
          return reply({
            encounterId: 'enc-1',
            version: 3,
            actorId: held,
            actions: [
              ...(!spent
                ? [
                    {
                      type: 'attack',
                      label: hintedAttack
                        ? 'Attack with Quarterstaff (move closer first)'
                        : 'Attack with Quarterstaff',
                      weaponId: 'quarterstaff',
                      targetIds: ['emil-1'],
                    },
                  ]
                : []),
              ...(extraAction ? [extraAction] : []),
              ...(moveRemainingFeet > 0
                ? [
                    {
                      type: 'move',
                      label: `Move (${moveRemainingFeet} ft remaining)`,
                      x: moveDestination.x,
                      y: moveDestination.y,
                    },
                  ]
                : []),
              { type: 'end_turn', label: 'End turn' },
            ],
          });
        if (url.endsWith('/status')) return reply({ encounter: { version: 3 } });
        if (body.phase === 'propose') {
          proposals.push(body);
          return reply({
            proposal: {
              legal: true,
              movementOnly: false,
              weaponName: 'Quarterstaff',
              attackBonus: 1,
              targetAc: 13,
              targetLabel: 'The Faceless Stalker',
              advantage: false,
              disadvantage: false,
            },
          });
        }
        requests.push(body);
        if (body.intent?.type === 'move') {
          moveDistanceFeet = Math.max(0, moveDistanceFeet - 30);
          moveRemainingFeet = 0;
          return reply({
            result: {
              applied: true,
              path: [{ x: 0, y: 0 }, moveDestination],
              movementRemaining: moveRemainingFeet,
              distanceFeet: moveDistanceFeet,
            },
          });
        }
        if (body.intent?.type === 'attack') {
          if (spent || (refuse && body.source === 'dm')) {
            spent = true;
            return reply({ error: 'Action already used this turn' }, 422);
          }
          if (movementOnlyAttack) {
            return reply({
              result: {
                resolvedAs: 'movement_only',
                movedFeet: 0,
                distanceFeet: moveDistanceFeet,
                reachFeet: 5,
                actorName: 'The Scholar',
                targetName: 'The Faceless Stalker',
              },
            });
          }
          spent = true;
          return reply({
            result: {
              ...killingBlow,
              d20: body.intent.d20 ?? 3,
              attackBonus: 1,
              totalAttackRoll: (body.intent.d20 ?? 3) + 1,
              targetAC: 13,
              hit: false,
              finalDamage: 0,
              targetName: 'The Faceless Stalker',
              targetNewHp: 10,
              targetIsDead: false,
              targetCondition: 'healthy',
              combatEnded: false,
              autoRolled: body.intent.d20 === undefined,
            },
          });
        }
        if (['dash', 'dodge', 'disengage'].includes(body.intent?.type)) {
          spent = true;
          return reply({
            result:
              body.intent.type === 'dash' ? null : { applied: true, action: body.intent.type },
          });
        }
        held = 'emil-1';
        round = 2;
        return reply({ result: { currentParticipant: participants[0] } });
      }),
    );
  });
  afterEach(() => {
    setPlayerRollHost(null);
    vi.unstubAllGlobals();
  });

  function Game({ playerMessage }: { playerMessage?: string } = {}) {
    const ai = useAIResponse();
    const onOptionSelect = async (text: string) => {
      response = await ai.getAIResponse(
        [{ text, sender: 'player', timestamp: new Date().toISOString() }] as any,
        DECLARED_ATTACK_SESSION_ID,
      );
    };
    return (
      <>
        {playerMessage && (
          <button onClick={() => void onOptionSelect(playerMessage)}>Cast from sheet</button>
        )}
        <DynamicOptionsSection
          options={[]}
          hasDynamicOverlay={true}
          onOptionSelect={onOptionSelect}
        />
      </>
    );
  }

  it('rolls the selected quarterstaff attack through declare → dialog → commit and advances the turn', async () => {
    // #2563 changed expectation: the chip used to send "I attack with Quarterstaff …"
    // as chat text and let the DM roll it. It now declares the attack itself (propose,
    // d20 dialog, commit) and settles the turn — the DM is never asked, so there is no
    // DM response carrying the miss line; the engine result is the board's refresh.
    render(<Game />);
    fireEvent.click(await screen.findByRole('button', { name: /Attack with Quarterstaff/ }));
    await waitFor(() => expect(advances).toBe(1));
    expect(vi.mocked(AIService.chatWithDM)).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
    expect(proposals).toEqual([
      expect.objectContaining({
        source: 'dm',
        phase: 'propose',
        intent: expect.objectContaining({
          type: 'attack',
          actorId: 'scholar-1',
          targetId: 'emil-1',
          weaponId: 'quarterstaff',
        }),
      }),
    ]);
    expect(requests.filter((r) => r.intent?.type === 'attack')).toEqual([
      expect.objectContaining({
        source: 'dm',
        origin: 'action_bar',
        intent: expect.objectContaining({ d20: 8 }),
      }),
    ]);
    expect(requests.some((r) => r.intent?.type === 'end_turn')).toBe(true);
    expect(round).toBe(2);
  });

  it('declares a hinted attack directly — the move hint never reaches the DM or the engine', async () => {
    // #2563 changed expectation: the hinted label used to travel as chat text (with the
    // hint stripped) for the DM to declare. The chip now declares the same attack
    // itself, so the hint cannot leak anywhere: no DM call is made at all.
    hintedAttack = true;
    render(<Game />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Attack with Quarterstaff \(move closer first\)/ }),
    );
    await waitFor(() => expect(advances).toBe(1));
    expect(vi.mocked(AIService.chatWithDM)).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
    expect(JSON.stringify([...proposals, ...requests])).not.toContain('move closer first');
    expect(requests.filter((request) => request.intent?.type === 'attack')).toHaveLength(1);
    expect(requests.some((request) => request.intent?.type === 'end_turn')).toBe(true);
  });

  it('moves through the real hook, keeps Action unused, and re-renders the gated attack', async () => {
    hintedAttack = true;
    const view = render(<Game />);
    fireEvent.click(await screen.findByRole('button', { name: /Move \(30 ft remaining\)/ }));
    await waitFor(() =>
      expect(requests.some((request) => request.intent?.type === 'move')).toBe(true),
    );
    expect(requests.find((request) => request.intent?.type === 'move')).toMatchObject({
      intent: { type: 'move', actorId: 'scholar-1', x: 6, y: 0 },
    });
    expect(moveDistanceFeet).toBe(20);
    expect(moveRemainingFeet).toBe(0);
    expect(spent).toBe(false);
    expect(
      await screen.findByRole('button', { name: /Attack with Quarterstaff \(move closer first\)/ }),
    ).toBeInTheDocument();
    expect(requests.some((request) => request.intent?.type === 'end_turn')).toBe(false);

    // A new turn resets movement; the second engine Move reaches melee and the same legal-action
    // refresh makes the attack live. Action remains unused because movement is separate.
    moveRemainingFeet = 30;
    moveDistanceFeet = 20;
    moveDestination = { x: 3, y: 0 };
    hintedAttack = false;
    round = 2;
    combatState.activeEncounter = encounterHeldBy(held, round, spent);
    view.rerender(<Game />);
    fireEvent.click(await screen.findByRole('button', { name: /Move \(30 ft remaining\)/ }));
    await waitFor(() => expect(moveDistanceFeet).toBe(0));
    expect(requests.filter((request) => request.intent?.type === 'move').at(-1)).toMatchObject({
      intent: { type: 'move', actorId: 'scholar-1', x: 3, y: 0 },
    });
    expect(
      await screen.findByRole('button', { name: /Attack with Quarterstaff$/ }),
    ).toBeInTheDocument();
    expect(spent).toBe(false);
  });

  it('keeps Action unused and the menu live after a movement-only hinted attack', async () => {
    // #2563 changed expectation: no DM turn narrates "no attack was rolled" any more;
    // the engine's movement-only answer simply leaves the turn open, and the refreshed
    // menu offers the attack again — now in reach.
    hintedAttack = true;
    movementOnlyAttack = true;
    render(<Game />);
    fireEvent.click(
      await screen.findByRole('button', { name: /Attack with Quarterstaff \(move closer first\)/ }),
    );
    await waitFor(() =>
      expect(requests.filter((request) => request.intent?.type === 'attack')).toHaveLength(1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /Attack with Quarterstaff \(move closer first\)/ }),
      ).toBeInTheDocument(),
    );
    expect(vi.mocked(AIService.chatWithDM)).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
    expect(spent).toBe(false);
    expect(advances).toBe(0);
    expect(round).toBe(1);
    expect(requests.some((request) => request.intent?.type === 'end_turn')).toBe(false);
  });

  it('explains a refused rolled attack and leaves End turn usable', async () => {
    // #2563 changed expectation: the refusal used to come back as DM prose. The commit
    // refusal now surfaces in the menu's own alert, and the turn is still the player's.
    refuse = true;
    render(<Game />);
    fireEvent.click(await screen.findByRole('button', { name: /Attack with Quarterstaff/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Action already used this turn');
    expect(vi.mocked(AIService.chatWithDM)).not.toHaveBeenCalled();
    expect(response).toBeUndefined();
    const end = screen.getByRole('button', { name: /End turn/ });
    expect(end).toBeEnabled();
    fireEvent.click(end);
    await waitFor(() => expect(requests.some((r) => r.intent?.type === 'end_turn')).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: /End turn/ })).toBeNull());
    expect(advances).toBe(0);
    expect(held).toBe('emil-1');
    expect(round).toBe(2);
    expect(requests.filter((r) => r.intent?.type === 'end_turn')).toEqual([
      expect.objectContaining({ intent: { type: 'end_turn', actorId: 'scholar-1' } }),
    ]);
  });

  it('explains a sheet spell the DM never declares without an undefined notice', async () => {
    vi.mocked(AIService.chatWithDM)
      .mockReset()
      .mockResolvedValue(envelope() as any);
    const playerMessage = buildSpellCastMessage({
      name: 'Burning Hands',
      id: 'burning-hands',
      level: 1,
    });
    render(<Game playerMessage={playerMessage} />);
    fireEvent.click(screen.getByRole('button', { name: 'Cast from sheet' }));
    await waitFor(() => expect(response?.text).toContain('it is still your turn'));
    expect(response.text).toContain('the DM did not declare it as a combat action');
    expect(response.text).not.toContain('undefined');
    expect(screen.getByRole('button', { name: /End turn/ })).toBeEnabled();
    expect(requests).toEqual([]);
    expect(advances).toBe(0);
  });

  it.each([
    ['dash', 'Dash'],
    ['dodge', 'Dodge'],
    ['disengage', 'Disengage'],
  ])('submits %s through the authoritative intent path', async (type, label) => {
    extraAction = { type, label };
    vi.mocked(AIService.chatWithDM)
      .mockReset()
      .mockImplementation(async () =>
        type === 'dash'
          ? (envelope() as any)
          : (envelope([{ ...declaredSwing, action_type: type, target_ids: [] }]) as any),
      );
    render(<Game />);
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }));
    await waitFor(() =>
      expect(requests.some((request) => request.intent?.type === type)).toBe(true),
    );
    if (type === 'dash') expect(vi.mocked(AIService.chatWithDM)).not.toHaveBeenCalled();
    else expect(vi.mocked(AIService.chatWithDM).mock.calls[0][0].message).toBe(label);
    expect(requests.filter((request) => request.intent?.type === type)).toEqual([
      expect.objectContaining({
        source: 'dm',
        origin: 'typed',
        intent: expect.objectContaining({ type, actorId: 'scholar-1' }),
      }),
    ]);
    if (type === 'dash')
      expect(requests.some((request) => request.intent?.type === 'end_turn')).toBe(false);
    else {
      expect(requests.some((request) => request.intent?.type === 'end_turn')).toBe(true);
      expect(response.text).not.toContain('undefined');
      expect(advances).toBe(1);
      expect(round).toBe(2);
    }
  });
});
