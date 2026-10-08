import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, it, expect, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../../../../shared/npc-engine-message';
import { DynamicOptionsSection } from '../DynamicOptionsSection';

import {
  executeAuthoritativeCombatIntent,
  executeStructuredCombatActionWithBoundary,
} from '@/services/combat/combat-action-executor';
import { askPlayerForAttackDie } from '@/services/combat/player-attack-roll';
import { askPlayerForSpellCast } from '@/services/combat/player-spell-cast';
import { userDataApi } from '@/services/user-data-api';

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
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { advanceNpcTurns: vi.fn() },
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
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({ results: [] } as any);
  });

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
    // The commit carries the player's own die; the turn then settles and the NPCs run.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ target_ids: [SWARM_1_ID], weapon_id: 'quarterstaff' }),
      15,
      'action_bar',
    );
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith('encounter-d5', {
      type: 'end_turn',
      actorId: SCHOLAR_ID,
    });
    expect(userDataApi.advanceNpcTurns).toHaveBeenCalledWith('session-d5', SWARM_1_ID);
    // The DM never sees this attack as text.
    expect(onOptionSelect).not.toHaveBeenCalled();
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
    vi.mocked(userDataApi.advanceNpcTurns).mockImplementation((async () => {
      // The server now delivers NPC results as system message rows (via buildNpcEngineMessage),
      // not as client-assembled onSendMessage calls. Simulate the server + request() dispatch.
      const npcResult = npcTurn.results[0];
      const message = buildNpcEngineMessage(
        [
          { id: SCHOLAR_ID, name: 'The Scholar', participantType: 'player', maxHp: 10 },
          { id: SWARM_1_ID, name: 'Light-Eater Swarm 1', participantType: 'monster' },
        ],
        2,
        {
          type: npcResult.action.action_type,
          actorId: npcResult.action.actor_id,
          targetIds: npcResult.action.target_ids,
        },
        npcResult.engineResult,
      );
      const row = {
        id: 'npc-row-swarm-attack',
        sequence: 100,
        text: message.text,
        kind: 'npc',
        actionId: 'swarm-attack-action',
        sessionId: 'session-d5',
        timestamp: new Date().toISOString(),
        context: message.context,
      };
      window.dispatchEvent(new CustomEvent('session-engine-rows', { detail: [row] }));
      return { ...npcTurn, engineRows: [row] };
    }) as any);

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

      // The NPC row carries the 2-damage attack and the party_defeated end reason, exactly once.
      expect(npcRows[0].text).toContain('2 damage');
      expect(npcRows[0].text).toContain('party_defeated');
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

  it('persists the attack, then one row for the death save, the DEAD line and the end reason when the turn boundary ends the fight (#2618)', async () => {
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
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
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

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
    const rows = rowsText();
    expect(rows[0]).toContain('2 damage');
    expect(rows[1]).toContain('The Scholar rolled 3 on their death saving throw');
    expect(rows[1]).toContain('DEAD');
    // The boundary's own result is one row: its death save, then the end reason.
    expect(rows[1].match(/death saving throw/g)?.length).toBe(1);
    expect(rows[1].match(/Combat ended/g)?.length).toBe(1);
    expect(rows[1]).toContain('a death save ended the fight');
    expect(new Set(rows).size).toBe(2);
    expect(userDataApi.advanceNpcTurns).not.toHaveBeenCalled();
    const deathRow = onSendMessage.mock.calls[1][0] as { context: { engineCards: any[] } };
    expect(deathRow.context.engineCards).toEqual([
      expect.objectContaining({ kind: 'death_save', deathSave: { successes: 0, failures: 3 } }),
    ]);
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
    vi.mocked(executeAuthoritativeCombatIntent).mockResolvedValue({
      currentParticipant: { id: SWARM_1_ID },
    } as any);
    vi.mocked(userDataApi.advanceNpcTurns).mockResolvedValue({ results: [] } as any);
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
    // The commit carries the player's own die; the turn then settles and the NPCs run.
    expect(executeStructuredCombatActionWithBoundary).toHaveBeenCalledWith(
      'encounter-d5',
      expect.objectContaining({ action_type: 'cast_spell', target_ids: [SWARM_1_ID] }),
      15,
      'action_bar',
    );
    expect(executeAuthoritativeCombatIntent).toHaveBeenCalledWith('encounter-d5', {
      type: 'end_turn',
      actorId: SCHOLAR_ID,
    });
    expect(userDataApi.advanceNpcTurns).toHaveBeenCalledWith('session-d5', SWARM_1_ID);
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
