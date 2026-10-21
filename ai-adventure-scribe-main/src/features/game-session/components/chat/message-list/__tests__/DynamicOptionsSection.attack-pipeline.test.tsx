import { act, render, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../../../../shared/npc-engine-message';
import { DynamicOptionsSection } from '../DynamicOptionsSection';

import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import { askPlayerForAttackDie } from '@/services/combat/player-attack-roll';
import { actorMovementRemaining } from '@/services/combat/player-movement-remaining';
import { askPlayerForSpellCast } from '@/services/combat/player-spell-cast';

/**
 * #2563, run D5 round 2: the "Attack with Quarterstaff" chip used to send
 * "I attack with Quarterstaff against Light-Eater Swarm 1." as chat text, making
 * the DM the first to see the attack — and when the DM's envelope failed to carry
 * the swing through, no die was ever rolled. The chip now runs the declare →
 * dialog → commit pipeline itself, against the legal action's engine ids.
 */
const SCHOLAR_ID = 'e7e569df-0000-4000-8000-000000000001';
const SWARM_1_ID = 'faea28f4-0000-4000-8000-000000000002';

const combat = vi.hoisted(() => {
  const SCHOLAR_ID = 'e7e569df-0000-4000-8000-000000000001';
  const SWARM_1_ID = 'faea28f4-0000-4000-8000-000000000002';
  const SWARM_2_ID = 'a0ee13a2-0000-4000-8000-000000000003';
  return {
    isInCombat: true,
    activeEncounter: {
      id: 'encounter-d5',
      sessionId: 'session-d5',
      currentRound: 2,
      currentTurnParticipantId: SCHOLAR_ID,
      participants: [
        { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player' },
        { id: SWARM_1_ID, name: 'Light-Eater Swarm 1', participantType: 'monster' },
        { id: SWARM_2_ID, name: 'Light-Eater Swarm 2', participantType: 'monster' },
      ],
    } as any,
  };
});
vi.mock('@/contexts/CombatContext', () => ({
  useCombat: () => ({ state: combat, refreshCombatState: vi.fn().mockResolvedValue(null) }),
}));
vi.mock('@/services/combat/combat-action-executor', () => ({
  executeAuthoritativeCombatIntent: vi.fn(),
  executeStructuredCombatActionWithBoundary: vi.fn(),
}));
vi.mock('@/services/combat/player-attack-roll', () => ({
  askPlayerForAttackDie: vi.fn(),
  isPlayerActor: (
    participantId: string,
    participants: Array<{ id: string; participantType?: string }>,
  ) =>
    participants.some(
      (participant) => participant.id === participantId && participant.participantType === 'player',
    ),
}));
vi.mock('@/services/combat/player-spell-cast', () => ({
  askPlayerForSpellCast: vi.fn(),
}));
vi.mock('@/services/combat/player-movement-remaining', () => ({
  actorMovementRemaining: vi.fn(),
}));
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options, onOptionSelect }: { options: any[]; onOptionSelect: any }) => (
    <div data-testid="action-options">
      {options.map((opt, i) => (
        <button key={i} onClick={() => onOptionSelect(opt)}>
          {opt.text}
        </button>
      ))}
    </div>
  ),
}));

describe('the attack option runs the declare pipeline, never DM text (#2563)', () => {
  const onOptionSelect = vi.fn().mockResolvedValue(undefined);
  const onSendMessage = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: SCHOLAR_ID,
        actions: [
          {
            type: 'attack',
            label: 'Attack with Quarterstaff',
            weaponId: 'quarterstaff',
            targetIds: [SWARM_1_ID],
          },
        ],
      }),
    } as Response);
    vi.mocked(askPlayerForAttackDie).mockResolvedValue({
      d20: 15,
      autoRolled: false,
      movementOnly: false,
    });
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [{ participantId: SWARM_1_ID, hit: true, finalDamage: 2, newHp: 2 }],
      boundary: null,
      result: { hit: true },
    } as any);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: { id: SWARM_1_ID },
    } as any);
    // Default: no movement left, so the turn settles as before (#263 keeps the old behavior
    // when the board is unknown or spent).
    vi.mocked(actorMovementRemaining).mockResolvedValue(0);
  });

  const PARTICIPANTS = [
    { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player', maxHp: 10 },
    { id: SWARM_1_ID, name: 'Light-Eater Swarm 1', participantType: 'monster' },
  ];
  /** A row as the server's writeNpcEngineRow stores and sends it (npc-engine-row.ts). */
  const serverRow = (
    id: string,
    actionId: string,
    intent: { type: string; actorId: string; targetIds?: string[] },
    result: unknown,
  ) => {
    const message = buildNpcEngineMessage(PARTICIPANTS, 2, intent, result);
    return {
      id,
      sequence: 100,
      text: message.text,
      kind: 'npc',
      actionId,
      sessionId: 'session-d5',
      timestamp: new Date().toISOString(),
      context: {
        ...message.context,
        npcResult: result,
        combatEncounterId: 'encounter-d5',
        actionId,
      },
    };
  };
  /**
   * The intent route's End turn as executeAuthoritativeCombatIntent hands it back: `payload.result`
   * with the creatures the server ran after it and every row it wrote, which the real executor
   * dispatches as `session-engine-rows`.
   */
  const serverEndTurn = (result: Record<string, unknown>, rows: unknown[], npcTurns?: unknown) =>
    (async () => {
      window.dispatchEvent(new CustomEvent('session-engine-rows', { detail: rows }));
      return { ...result, ...(npcTurns ? { npcTurns } : {}), engineRows: rows };
    }) as any;
  const keyedEndTurn = {
    type: 'end_turn',
    actorId: SCHOLAR_ID,
    actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  };

  it('opens the dialog and posts the declare intent with the engine id', async () => {
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    await waitFor(() => expect(askPlayerForAttackDie).toHaveBeenCalled());
    expect(askPlayerForAttackDie).toHaveBeenCalledWith({
      encounterId: 'encounter-d5',
      action: {
        actor_id: SCHOLAR_ID,
        action_type: 'attack',
        target_ids: [SWARM_1_ID],
        weapon_id: 'quarterstaff',
        spell_id: null,
        slot_level: null,
        movement_feet: 0,
      },
      actorLabel: 'The Scholar',
    });
    // The commit carries the player's own die; the turn then settles, keyed, and the server runs
    // the NPCs inside that one request (#2658 step 3): there is no second call.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ target_ids: [SWARM_1_ID], weapon_id: 'quarterstaff' }),
      15,
      undefined,
      'action_bar',
    );
    await waitFor(() =>
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith('encounter-d5', keyedEndTurn),
    );
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledTimes(1);
    // The DM never sees this attack as text.
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('lets the engine roll when the 45 s timer expires instead of stopping (#566)', async () => {
    // The prompt promised "Rolls for you in N s": the bridge timer settles
    // { d20: null, timedOut: true }, so the chip commits with no player die and the
    // engine rolls — unlike a refused/dismissed popup, which stops with a menu alert.
    vi.mocked(askPlayerForAttackDie).mockResolvedValue({
      autoRolled: true,
      movementOnly: false,
      timedOut: true,
    });
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    await waitFor(() => expect(askPlayerForAttackDie).toHaveBeenCalled());
    // The commit carries no player die: the engine rolls, as the countdown promised.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ target_ids: [SWARM_1_ID], weapon_id: 'quarterstaff' }),
      undefined,
      undefined,
      'action_bar',
    );
    // No menu alert: nothing failed, and the DM never sees this attack as text.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('one attack with movement left does not end the turn (#263 CB-011)', async () => {
    // The Scholar still has 30 ft after the swing: the turn stays open and the refreshed
    // menu offers Move / End turn instead of the attack spending the whole turn.
    vi.mocked(actorMovementRemaining).mockResolvedValue(30);
    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={onOptionSelect}
        onSendMessage={onSendMessage}
        hasDynamicOverlay
      />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    await waitFor(() => expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalled());
    expect(actorMovementRemaining).toHaveBeenCalledWith('session-d5', SCHOLAR_ID);
    // No end_turn: the turn is still the player's.
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    // The DM never sees this attack as text.
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('posts the player result before any turn-end when movement remains (#263 CB-024)', async () => {
    // CB-024: the log must show the player's attack result BEFORE "ended their turn" and
    // enemy lines. With movement remaining, the attack handler posts the player's result
    // via onSendMessage and sends no end_turn: the turn-end (and any enemy actions) can
    // only happen after, when the player explicitly ends the turn.
    vi.mocked(actorMovementRemaining).mockResolvedValue(30);
    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={onOptionSelect}
        onSendMessage={onSendMessage}
        hasDynamicOverlay
      />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    // The player's result is posted first.
    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    const playerMessage = onSendMessage.mock.calls[0][0] as { text: string };
    expect(playerMessage.text).toContain('HIT');
    // And no turn boundary has been crossed yet: no end_turn intent.
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
  });

  it('orders result, then end_turn, then enemy lines when the turn settles (#263 CB-024)', async () => {
    // CB-024: with no movement left the attack settles the turn. The log must show the
    // player's attack result BEFORE the end_turn intent, and the enemy lines only arrive
    // via the server's end_turn response — never before the player's result is visible.
    // Default mock: actorMovementRemaining -> 0, so the turn settles.
    const npcRow = serverRow(
      'npc-row-swarm-attack',
      'swarm-attack-action',
      { type: 'attack', actorId: SWARM_1_ID, targetIds: [SCHOLAR_ID] },
      {
        actorName: 'Light-Eater Swarm 1',
        targetName: 'The Scholar',
        hit: true,
        finalDamage: 2,
        targetNewHp: 8,
        targetIsConscious: true,
      },
    );
    vi.mocked(executeAuthoritativeCombatIntent).mockImplementation(
      serverEndTurn({ currentParticipant: { id: SWARM_1_ID } }, [npcRow]),
    );

    // Capture the server-delivered enemy row, noting the end_turn call order when it lands.
    const npcRows: Array<{ text: string }> = [];
    const mockedEndTurn = vi.mocked(executeAuthoritativeCombatIntent);
    let endTurnOrderAtNpcRow = -1;
    const capture = (event: Event) => {
      endTurnOrderAtNpcRow = mockedEndTurn.mock.invocationCallOrder[0];
      npcRows.push(...((event as CustomEvent).detail as Array<{ text: string }>));
    };
    window.addEventListener('session-engine-rows', capture);
    try {
      render(
        <DynamicOptionsSection
          options={[]}
          onOptionSelect={onOptionSelect}
          onSendMessage={onSendMessage}
          hasDynamicOverlay
        />,
      );
      fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

      // 1) The player's result is posted.
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      expect((onSendMessage.mock.calls[0][0] as { text: string }).text).toContain('HIT');
      // 2) Then the end_turn intent is sent.
      await waitFor(() =>
        expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith(
          'encounter-d5',
          keyedEndTurn,
        ),
      );
      // 3) Then the enemy line arrives via the server's end_turn response.
      await waitFor(() => expect(npcRows).toHaveLength(1));
      expect(npcRows[0].text).toContain('2 damage');

      // Invocation order: result posted < end_turn sent <= enemy line delivered.
      const resultOrder = onSendMessage.mock.invocationCallOrder[0];
      const endTurnOrder = mockedEndTurn.mock.invocationCallOrder[0];
      expect(resultOrder).toBeLessThan(endTurnOrder);
      expect(endTurnOrderAtNpcRow).toBe(endTurnOrder);
    } finally {
      window.removeEventListener('session-engine-rows', capture);
    }
  });

  it('posts no notice of its own when the server persisted the killing attack row (#570)', async () => {
    // The killing blow: the server now writes the actor's engine row itself and
    // posts the Victory notice behind it, so the result carries the row
    // (kind 'player', built by the real producer like every server row here).
    // This section's own notice would print the same lines a second time.
    const killResult = {
      actorName: 'The Scholar',
      targetName: 'Light-Eater Swarm 1',
      hit: true,
      finalDamage: 7,
      targetNewHp: 0,
      targetIsConscious: false,
      combatEnded: true,
      endedReason: 'last_hostile_defeated',
    };
    const playerRow = {
      ...serverRow(
        'player-row-kill',
        'kill-action',
        { type: 'attack', actorId: SCHOLAR_ID, targetIds: [SWARM_1_ID] },
        killResult,
      ),
      kind: 'player' as const,
    };
    expect(playerRow.text).toContain('Combat ended');
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [{ participantId: SWARM_1_ID, hit: true, finalDamage: 7, newHp: 0 }],
      boundary: 'combat_ended',
      result: { ...killResult, engineRows: [playerRow] },
    } as any);
    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={onOptionSelect}
        onSendMessage={onSendMessage}
        hasDynamicOverlay
      />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    await waitFor(() =>
      expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledTimes(1),
    );
    // Let the branch run to its finally: a macrotask drains the whole chain of
    // already-resolved mocked promises the branch awaits after the execution.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onSendMessage).not.toHaveBeenCalled();
    // The fight is over: no end_turn settle follows a combat_ended boundary.
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('still posts its notice when the result carries only creature rows (#570)', async () => {
    // Control for the case above: rows for OTHER actors (the drain) do not
    // suppress the player's own notice — only the actor's persisted row does.
    const npcRow = serverRow(
      'npc-row-drain',
      'drain-action',
      { type: 'attack', actorId: 'a0ee13a2-0000-4000-8000-000000000003', targetIds: [SCHOLAR_ID] },
      {
        actorName: 'Light-Eater Swarm 2',
        targetName: 'The Scholar',
        hit: true,
        finalDamage: 2,
        targetNewHp: 8,
        targetIsConscious: true,
      },
    );
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [{ participantId: SWARM_1_ID, hit: true, finalDamage: 7, newHp: 0 }],
      boundary: 'combat_ended',
      result: {
        actorName: 'The Scholar',
        targetName: 'Light-Eater Swarm 1',
        hit: true,
        finalDamage: 7,
        targetNewHp: 0,
        targetIsConscious: false,
        combatEnded: true,
        endedReason: 'last_hostile_defeated',
        engineRows: [npcRow],
      },
    } as any);
    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={onOptionSelect}
        onSendMessage={onSendMessage}
        hasDynamicOverlay
      />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    expect((onSendMessage.mock.calls[0][0] as { text: string }).text).toContain('Combat ended');
    // #976: the fallthrough notice is this fight's terminal message — it carries
    // the combatEnded stamp for the summary gate and a stable id from creation.
    const notice = onSendMessage.mock.calls[0][0] as { id?: string; context?: any };
    expect(notice.id).toEqual(expect.any(String));
    expect(notice.context).toMatchObject({ combatEnded: true });
  });

  it('a movement-only approach spends no Action and keeps the turn open', async () => {
    vi.mocked(askPlayerForAttackDie).mockResolvedValue({
      autoRolled: false,
      movementOnly: true,
    });
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [],
      boundary: null,
      result: { resolvedAs: 'movement_only' },
    } as any);
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    await waitFor(() => expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalled());
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ type: 'end_turn' }),
    );
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  // Migrated (#2658 step 3): the NPC row used to come from the client's advance-npc-turns call;
  // it now arrives with the End turn response the server answered after running the swarm.
  it('persists each player and NPC engine result exactly once, including zero damage and the end reason (#2622)', async () => {
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [{ participantId: SWARM_1_ID, hit: true, finalDamage: 0, newHp: 2 }],
      boundary: null,
      result: {
        actorName: 'The Scholar',
        targetName: 'Light-Eater Swarm 1',
        d20: 15,
        attackBonus: 4,
        totalAttackRoll: 19,
        targetAC: 12,
        hit: true,
        finalDamage: 0,
        targetNewHp: 2,
        targetCondition: 'wounded',
        weaponResolution: { resolved: 'Quarterstaff' },
      },
    } as any);
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: { id: SWARM_1_ID },
    } as any);
    const npcTurn = {
      results: [
        {
          action: {
            actor_id: SWARM_1_ID,
            action_type: 'attack',
            target_ids: [SCHOLAR_ID],
            weapon_id: null,
            spell_id: null,
            slot_level: null,
            movement_feet: 0,
          },
          engineResult: {
            actorName: 'Light-Eater Swarm 1',
            targetName: 'The Scholar',
            hit: true,
            finalDamage: 2,
            targetNewHp: 8,
            targetIsConscious: true,
            endedReason: 'party_defeated',
          },
          outcomes: [{ participantId: SCHOLAR_ID, hit: true, finalDamage: 2, newHp: 8 }],
          actorIsPlayer: false,
          transcriptLines: [],
        },
      ],
      combatEnded: true,
      endedReason: 'party_defeated',
      capReached: false,
      transcriptLines: [],
    };
    // The server runs the swarm inside the End turn and writes its row (buildNpcEngineMessage);
    // the executor dispatches the response's engineRows.
    const npcResult = npcTurn.results[0];
    const npcRow = serverRow(
      'npc-row-swarm-attack',
      'swarm-attack-action',
      {
        type: npcResult.action.action_type,
        actorId: npcResult.action.actor_id,
        targetIds: npcResult.action.target_ids,
      },
      npcResult.engineResult,
    );
    vi.mocked(executeAuthoritativeCombatIntent).mockImplementation(
      serverEndTurn({ currentParticipant: { id: SWARM_1_ID } }, [npcRow], {
        ...npcTurn,
        engineRows: [npcRow],
      }),
    );

    // Capture the server-delivered NPC row.
    const npcRows: Array<{ text: string; context: any }> = [];
    const capture = (event: Event) => {
      npcRows.push(...((event as CustomEvent).detail as Array<{ text: string; context: any }>));
    };
    window.addEventListener('session-engine-rows', capture);
    try {
      render(
        <DynamicOptionsSection
          options={[]}
          onOptionSelect={onOptionSelect}
          onSendMessage={onSendMessage}
          hasDynamicOverlay
        />,
      );
      fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

      // The player's attack (0 damage) goes via onSendMessage; the NPC's attack and the
      // end reason arrive as a server-delivered row.
      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(npcRows).toHaveLength(1));

      const playerRows = onSendMessage.mock.calls.map(
        ([message]) => message as { text: string; persist?: boolean },
      );
      expect(playerRows[0].text).toContain('0 damage');
      expect(playerRows[0].persist).toBe(true);

      // The NPC row carries the 2-damage attack and the party_defeated end, exactly once:
      // the end renders as player text (#976); the key itself stays in the stored result,
      // and the row context carries the terminal flag the Combat Summary gate reads.
      expect(npcRows[0].text).toContain('2 damage');
      expect(npcRows[0].text).toContain('Combat ended — the party was defeated.');
      expect(npcRows[0].text).not.toContain('party_defeated');
      expect((npcRows[0].context as any).npcResult.endedReason).toBe('party_defeated');
      expect((npcRows[0].context as any).combatEnded).toBe(true);
      const npcBlock = (npcRows[0].context as any).combatEngineBlocks[0];
      expect(npcBlock).toMatchObject({ source: 'npc' });
    } finally {
      window.removeEventListener('session-engine-rows', capture);
    }
  });

  it('persists the opportunity attack before the correct flee or yield result (#2580)', async () => {
    const cases = [
      {
        action: { type: 'flee', label: 'Flee' },
        result: {
          exit: 'fled',
          opportunityAttack: {
            attackerName: 'Light-Eater Swarm 1',
            hit: true,
            finalDamage: 3,
          },
        },
        expectRow: (text: string) => {
          expect(text).toContain('Light-Eater Swarm 1');
          expect(text).toContain('3 damage');
          expect(text).toContain('fled');
        },
      },
      {
        action: { type: 'flee', label: 'Flee' },
        result: {
          exit: null,
          opportunityAttack: {
            attackerName: 'Light-Eater Swarm 1',
            hit: true,
            finalDamage: 7,
          },
        },
        expectRow: (text: string) => {
          expect(text).toContain('Light-Eater Swarm 1');
          expect(text).toContain('7 damage');
          expect(text).toContain('did not get away');
          expect(text).not.toContain('fled');
        },
      },
      {
        action: { type: 'yield', label: 'Yield' },
        result: { exit: 'surrendered', opportunityAttack: null },
        expectRow: (text: string) => {
          expect(text).toContain('yielded');
          expect(text).not.toContain('fled');
        },
      },
    ] as const;

    for (const testCase of cases) {
      vi.mocked(globalThis.fetch).mockResolvedValue({
        ok: true,
        json: async () => ({ actorId: SCHOLAR_ID, actions: [testCase.action] }),
      } as Response);
      vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue(testCase.result as any);

      const view = render(
        <DynamicOptionsSection
          options={[]}
          onOptionSelect={onOptionSelect}
          onSendMessage={onSendMessage}
          hasDynamicOverlay
        />,
      );
      fireEvent.click(await screen.findByText(testCase.action.label));

      await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
      const row = onSendMessage.mock.calls[0][0] as { text: string };
      testCase.expectRow(row.text);
      view.unmount();
      onSendMessage.mockClear();
    }
  });

  const rowsText = () =>
    onSendMessage.mock.calls.map(([message]) => (message as { text: string }).text);

  // Migrated (#2658 step 3): was "persists the attack, then one row for the death save, the DEAD
  // line and the end reason when the turn boundary ends the fight (#2618)". The boundary's row is
  // now the server's (the keyed End turn writes it); the client writes only the attack.
  it('persists the attack; the keyed End turn brings one server row with the death save, the DEAD line and the end reason (#2618)', async () => {
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [{ participantId: SWARM_1_ID, hit: true, finalDamage: 2, newHp: 2 }],
      boundary: null,
      result: {
        actorName: 'The Scholar',
        targetName: 'Light-Eater Swarm 1',
        d20: 15,
        attackBonus: 4,
        totalAttackRoll: 19,
        targetAC: 12,
        hit: true,
        finalDamage: 2,
        targetNewHp: 2,
        targetCondition: 'wounded',
        weaponResolution: { resolved: 'Quarterstaff' },
      },
    } as any);
    const boundary = {
      currentParticipant: { id: SWARM_1_ID },
      deathSaves: [
        {
          participantId: SCHOLAR_ID,
          roll: 3,
          isSuccess: false,
          successes: 0,
          failures: 3,
          isDead: true,
        },
      ],
      combatEnded: true,
      endedReason: 'death_save_failed',
    };
    const boundaryRow = serverRow(
      'end-turn-row',
      'end-turn-action',
      { type: 'end_turn', actorId: SCHOLAR_ID },
      boundary,
    );
    vi.mocked(executeAuthoritativeCombatIntent).mockImplementation(
      serverEndTurn(boundary, [boundaryRow]),
    );
    const delivered: Array<{ text: string; context: any }> = [];
    const capture = (event: Event) => {
      delivered.push(...((event as CustomEvent).detail as Array<{ text: string; context: any }>));
    };
    window.addEventListener('session-engine-rows', capture);
    try {
      render(
        <DynamicOptionsSection
          options={[]}
          onOptionSelect={onOptionSelect}
          onSendMessage={onSendMessage}
          hasDynamicOverlay
        />,
      );
      fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

      await waitFor(() => expect(delivered).toHaveLength(1));
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith('encounter-d5', keyedEndTurn);
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledTimes(1);
      const rows = rowsText();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toContain('2 damage');
      const deathRow = delivered[0];
      expect(deathRow.text).toContain('The Scholar rolled 3 on their death saving throw');
      expect(deathRow.text).toContain('DEAD');
      // The boundary's own result is one row: its death save, then the end reason.
      expect(deathRow.text.match(/death saving throw/g)?.length).toBe(1);
      expect(deathRow.text.match(/Combat ended/g)?.length).toBe(1);
      expect(deathRow.text).toContain('a death save ended the fight');
      expect(deathRow.context.engineCards).toEqual([
        expect.objectContaining({ kind: 'death_save', deathSave: { successes: 0, failures: 3 } }),
      ]);
    } finally {
      window.removeEventListener('session-engine-rows', capture);
    }
  });

  it("carries the stable hero's wake-up on the row of the result that ended the fight (#2518)", async () => {
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [{ participantId: SWARM_1_ID, hit: true, finalDamage: 4, newHp: 0 }],
      boundary: 'combat_ended',
      result: {
        actorName: 'The Scholar',
        targetName: 'Light-Eater Swarm 1',
        d20: 15,
        attackBonus: 4,
        totalAttackRoll: 19,
        targetAC: 12,
        hit: true,
        finalDamage: 4,
        targetNewHp: 0,
        targetCondition: 'dead',
        weaponResolution: { resolved: 'Quarterstaff' },
        combatEnded: true,
        endedReason: 'last_hostile_defeated',
        wake: [{ name: 'The Scholar', hours: 3 }],
      },
    } as any);

    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={onOptionSelect}
        onSendMessage={onSendMessage}
        hasDynamicOverlay
      />,
    );
    fireEvent.click(await screen.findByText('Attack with Quarterstaff'));

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    const [row] = rowsText();
    expect(row).toContain('4 damage');
    expect(row).toContain('The Scholar');
    expect(row.match(/wake/gi)?.length).toBe(1);
    expect(row).toContain('the last hostile was defeated');
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
  });
});

describe('the spell-attack option runs the declare pipeline, never DM text (#2581)', () => {
  const onOptionSelect = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: SCHOLAR_ID,
        actions: [
          {
            type: 'spell',
            label: 'Cast Chill Touch',
            spellId: 'chill-touch',
            targetIds: [SWARM_1_ID],
          },
        ],
      }),
    } as Response);
    vi.mocked(askPlayerForSpellCast).mockResolvedValue({
      d20: 15,
      autoRolled: false,
      movementOnly: false,
    });
    vi.mocked(executeStructuredCombatActionWithBoundary).mockResolvedValue({
      outcomes: [{ participantId: SWARM_1_ID, hit: true, finalDamage: 4, newHp: 1 }],
      boundary: null,
      result: { hit: true },
    } as any);
    // The intent route's `payload.result` for the End turn: the server ran the swarm inside it.
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: { id: SWARM_1_ID },
      npcTurns: {
        results: [],
        currentParticipant: { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player' },
        round: 2,
        combatEnded: false,
        iterationCount: 1,
        iterationCap: 6,
        capReached: false,
        transcriptLines: [],
        engineRows: [],
      },
      engineRows: [],
    } as any);
  });

  it('opens the dialog and posts the declare intent with the engine ids', async () => {
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Cast Chill Touch'));

    await waitFor(() => expect(askPlayerForSpellCast).toHaveBeenCalled());
    expect(askPlayerForSpellCast).toHaveBeenCalledWith({
      encounterId: 'encounter-d5',
      action: {
        actor_id: SCHOLAR_ID,
        action_type: 'cast_spell',
        target_ids: [SWARM_1_ID],
        weapon_id: null,
        spell_id: 'chill-touch',
        slot_level: null,
        movement_feet: 0,
      },
      actorLabel: 'The Scholar',
      participants: combat.activeEncounter.participants,
    });
    // The commit carries the player's own die; the turn then settles, keyed, and the server runs
    // the NPCs inside that one request (#2658 step 3): there is no second call.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ action_type: 'cast_spell', target_ids: [SWARM_1_ID] }),
      15,
      undefined,
      'action_bar',
    );
    await waitFor(() =>
      expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith('encounter-d5', {
        type: 'end_turn',
        actorId: SCHOLAR_ID,
        actionId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledTimes(1);
    // The DM never sees this cast as text.
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('a save spell still goes out as chat text', async () => {
    // #2581: only attack-roll spells take the pipeline. A save spell keeps today's
    // behavior: its label goes to the DM as text. `resolvePlayerCombatSpell` is the
    // real one here — the save classification is what the chip contract depends on.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: SCHOLAR_ID,
        // Attack-shaped on purpose: with targets present the component reaches the kind
        // gate, so this test pins the gate itself rather than the missing-targets fallthrough.
        actions: [
          {
            type: 'spell',
            label: 'Cast Sacred Flame',
            spellId: 'sacred-flame',
            targetIds: [SWARM_1_ID],
          },
        ],
      }),
    } as Response);
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Cast Sacred Flame'));

    await waitFor(() => expect(onOptionSelect).toHaveBeenCalledWith('Cast Sacred Flame'));
    expect(askPlayerForSpellCast).not.toHaveBeenCalled();
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
  });

  it('stops with a menu alert when the spell proposal is refused (autoRolled, no d20)', async () => {
    // #2652 round 4: when askPlayerForSpellCast returns autoRolled (proposal refused/
    // failed, popup threw, or d20 null), the chip must stop, show the menu alert, and
    // spend nothing — not commit with an undefined d20.
    vi.mocked(askPlayerForSpellCast).mockResolvedValue({
      autoRolled: true,
      movementOnly: false,
    });
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Cast Chill Touch'));

    await waitFor(() => expect(askPlayerForSpellCast).toHaveBeenCalled());
    // The commit never happens: no d20, no engine roll for the player.
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(executeAuthoritativeCombatIntent).not.toHaveBeenCalled();
    expect(onOptionSelect).not.toHaveBeenCalled();
    // The menu alert is shown.
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be cast');
  });

  it('lets the engine roll when the 45 s timer expires instead of stopping (#566)', async () => {
    // The prompt promised "Rolls for you in N s": the bridge timer settles
    // { d20: null, timedOut: true }, so the chip commits with no player die and the
    // engine rolls — unlike a refused/dismissed popup, which stops with a menu alert.
    vi.mocked(askPlayerForSpellCast).mockResolvedValue({
      autoRolled: true,
      movementOnly: false,
      timedOut: true,
    });
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Cast Chill Touch'));

    await waitFor(() => expect(askPlayerForSpellCast).toHaveBeenCalled());
    // The commit carries no player die: the engine rolls, as the countdown promised.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ action_type: 'cast_spell', target_ids: [SWARM_1_ID] }),
      undefined,
      undefined,
      'action_bar',
    );
    // No menu alert: nothing failed, and the DM never sees this cast as text.
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it('refuses a stale attack-spell chip with no targets instead of sending it as chat text', async () => {
    // #2652 round 5: a stale menu can hold an attack-kind spell chip whose targets are
    // gone. The server withholds such chips, but the client refuses them too — the label
    // must not go to the DM as chat text.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        actorId: SCHOLAR_ID,
        actions: [
          {
            type: 'spell',
            label: 'Cast Chill Touch',
            spellId: 'chill-touch',
            targetIds: [],
          },
        ],
      }),
    } as Response);
    render(
      <DynamicOptionsSection options={[]} onOptionSelect={onOptionSelect} hasDynamicOverlay />,
    );
    fireEvent.click(await screen.findByText('Cast Chill Touch'));

    expect(await screen.findByRole('alert')).toHaveTextContent('needs a target');
    expect(askPlayerForSpellCast).not.toHaveBeenCalled();
    expect(executeStructuredCombatActionWithBoundary).not.toHaveBeenCalled();
    expect(onOptionSelect).not.toHaveBeenCalled();
  });
});
