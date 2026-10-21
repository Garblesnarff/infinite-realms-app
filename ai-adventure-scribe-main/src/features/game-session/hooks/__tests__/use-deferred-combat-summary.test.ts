import { renderHook, type RenderHookResult } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildNpcEngineMessage } from '../../../../../shared/npc-engine-message';
import {
  COMBAT_SUMMARY_FALLBACK_MS,
  buildCombatSummaryMessageFromServer,
  useDeferredCombatSummary,
  type ServerDamageSummary,
} from '../use-deferred-combat-summary';

import type { CombatEncounter } from '@/types/combat-encounter';
import type { ChatMessage } from '@/types/game';

const encounter = { currentRound: 3, participants: [], actions: [] } as unknown as CombatEncounter;

const dm = (id: string, combatEnded = false): ChatMessage => ({
  id,
  text: `DM ${id}`,
  sender: 'dm',
  context: combatEnded ? { combatEnded: true } : {},
});

type Props = { isInCombat: boolean; messages: ChatMessage[]; messagesLoading?: boolean };

describe('useDeferredCombatSummary', () => {
  const sendMessage = vi.fn();
  const onCombatEnded = vi.fn();

  const setup = (initial: Props): RenderHookResult<void, Props> =>
    renderHook(
      (props: Props) =>
        useDeferredCombatSummary({
          ...props,
          activeEncounter: props.isInCombat ? encounter : null,
          sendMessage,
          onCombatEnded,
        }),
      { initialProps: initial },
    );

  const summaries = (): Array<[ChatMessage]> =>
    sendMessage.mock.calls.filter(([message]) => message.text === 'Combat has ended.') as Array<
      [ChatMessage]
    >;

  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage.mockReset();
    onCombatEnded.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for the terminal DM message, then posts the summary after it', () => {
    const { rerender } = setup({ isInCombat: true, messages: [dm('a')] });

    rerender({ isInCombat: false, messages: [dm('a')] });
    expect(onCombatEnded).toHaveBeenCalledTimes(1);
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [dm('a'), dm('kill', true)] });
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0][0].context).toMatchObject({
      combatData: { type: 'summary', summary: { rounds: 3 } },
    });
  });

  it("ignores an earlier fight's terminal message in the same session", () => {
    const firstFight = [dm('a'), dm('kill-1', true)];
    const { rerender } = setup({ isInCombat: false, messages: firstFight });

    rerender({ isInCombat: true, messages: firstFight });
    rerender({ isInCombat: true, messages: [...firstFight, dm('b')] });
    rerender({ isInCombat: false, messages: [...firstFight, dm('b')] });
    // The first fight's combatEnded message is still in the transcript. It must not release the
    // second fight's summary ahead of its own killing blow.
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [...firstFight, dm('b'), dm('kill-2', true)] });
    expect(summaries()).toHaveLength(1);
  });

  it('accepts a terminal message that landed just before combat state flipped', () => {
    const { rerender } = setup({ isInCombat: true, messages: [dm('a')] });

    rerender({ isInCombat: true, messages: [dm('a'), dm('kill', true)] });
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [dm('a'), dm('kill', true)] });
    expect(summaries()).toHaveLength(1);
  });

  it('posts the summary after the fallback when the terminal message never arrives', () => {
    const { rerender } = setup({ isInCombat: true, messages: [dm('a')] });

    rerender({ isInCombat: false, messages: [dm('a')] });
    vi.advanceTimersByTime(COMBAT_SUMMARY_FALLBACK_MS - 1);
    expect(summaries()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(summaries()).toHaveLength(1);

    // A late terminal message after the fallback does not post a second summary.
    rerender({ isInCombat: false, messages: [dm('a'), dm('kill', true)] });
    vi.advanceTimersByTime(COMBAT_SUMMARY_FALLBACK_MS);
    expect(summaries()).toHaveLength(1);
  });

  it('does not post twice when the terminal message beats the fallback', () => {
    const { rerender } = setup({ isInCombat: true, messages: [] });

    rerender({ isInCombat: false, messages: [] });
    rerender({ isInCombat: false, messages: [dm('kill', true)] });
    vi.advanceTimersByTime(COMBAT_SUMMARY_FALLBACK_MS * 2);

    expect(summaries()).toHaveLength(1);
  });

  it('treats history hydrated during a reloaded fight as an earlier fight', () => {
    const { rerender } = setup({ isInCombat: true, messages: [], messagesLoading: true });

    rerender({ isInCombat: true, messages: [dm('old-kill', true)], messagesLoading: true });
    rerender({ isInCombat: true, messages: [dm('old-kill', true)], messagesLoading: false });
    rerender({ isInCombat: false, messages: [dm('old-kill', true)] });
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [dm('old-kill', true), dm('kill', true)] });
    expect(summaries()).toHaveLength(1);
  });

  // #976: a fight the SERVER ends (the player's killing blow resolved by the combat
  // intent endpoint) never gets a terminal DM message — no DM turn runs, and the next
  // one starts with combat already inactive, so use-ai-response cannot stamp
  // combatEnded on it. The fight's end is presented by the terminal engine row the
  // server persists for the killing action; the summary must release on that row
  // instead of waiting out the fallback (Hark N21-023: no card on a 7-round win).
  it('posts the summary on the terminal engine row of a server-ended fight (#976)', () => {
    const roster = [
      { id: 'pc-1', name: 'Ghorza', participantType: 'player', maxHp: 28 },
      { id: 'm-1', name: "Remy 'The Manager'", participantType: 'monster', maxHp: 11 },
    ];
    // The settled result the intent service hands back for the killing blow:
    // markCombatEnded spreads combatEnded/endedReason over the attack result.
    const killResult = {
      actorName: 'Ghorza',
      targetName: "Remy 'The Manager'",
      hit: true,
      finalDamage: 9,
      targetNewHp: 0,
      targetIsConscious: false,
      combatEnded: true,
      endedReason: 'last_hostile_defeated',
    };
    // The row as the client receives it: buildNpcEngineMessage is the real producer
    // (writeNpcEngineRow stores it with npcResult + combatEncounterId added), and
    // use-messages merges the persisted row as sender 'system' with that context.
    const built = buildNpcEngineMessage(
      roster,
      7,
      { type: 'attack', actorId: 'pc-1', targetIds: ['m-1'] },
      killResult,
    );
    const terminalRow: ChatMessage = {
      id: 'terminal-row-976',
      text: built.text,
      sender: 'system',
      context: {
        ...built.context,
        npcResult: killResult,
        combatEncounterId: 'enc-976',
        actionId: 'kill-action',
      },
    };
    expect(terminalRow.text).toContain('Combat ended');

    const { rerender } = setup({ isInCombat: true, messages: [dm('a')] });

    // The row lands during the intent call, before the combat state flips.
    rerender({ isInCombat: true, messages: [dm('a'), terminalRow] });
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [dm('a'), terminalRow] });
    expect(summaries()).toHaveLength(1);

    // The fallback must not post a second summary afterwards.
    vi.advanceTimersByTime(COMBAT_SUMMARY_FALLBACK_MS * 2);
    expect(summaries()).toHaveLength(1);
  });

  it("ignores an earlier fight's terminal engine row in the same session (#976)", () => {
    // The row carries the stable id the server writer gave it (and a local notice
    // carries the id sendEngineNotice assigns at creation), so the baseline taken
    // at the second fight's start holds its key in both its live and hydrated
    // forms — it must not release the second fight's summary.
    const row = (id: string): ChatMessage => ({
      id,
      text: `row ${id}`,
      sender: 'system',
      context: { intent: 'combat_npc_result', combatEnded: true },
    });
    const firstFight = [dm('a'), row('row-fight-1')];
    const { rerender } = setup({ isInCombat: false, messages: firstFight });

    rerender({ isInCombat: true, messages: firstFight });
    rerender({ isInCombat: true, messages: [...firstFight, dm('b')] });
    rerender({ isInCombat: false, messages: [...firstFight, dm('b')] });
    expect(summaries()).toHaveLength(0);

    rerender({ isInCombat: false, messages: [...firstFight, dm('b'), row('row-fight-2')] });
    expect(summaries()).toHaveLength(1);
  });
});

describe('server damage summary (#570)', () => {
  const sendMessage = vi.fn();

  const serverEncounter = {
    id: 'enc-1',
    sessionId: 'sess-1',
    origin: 'server',
    currentRound: 1,
    participants: [
      {
        id: 'pc-1',
        name: 'The Sous Chef',
        maxHitPoints: 24,
        currentHitPoints: 24,
        isDead: false,
        isUnconscious: false,
      },
      {
        id: 'm-1',
        name: 'Proctor',
        maxHitPoints: 7,
        currentHitPoints: 7,
        isDead: false,
        isUnconscious: false,
      },
    ],
    actions: [],
  } as unknown as CombatEncounter;

  const serverSummary: ServerDamageSummary = {
    encounterId: 'enc-1',
    rounds: 1,
    totalDamage: 7,
    participants: [
      { participantId: 'pc-1', name: 'The Sous Chef', damageDealt: 7, damageTaken: 0, status: 'ok' },
      { participantId: 'm-1', name: 'Proctor', damageDealt: 0, damageTaken: 7, status: 'dead' },
    ],
  };

  const fetchJson = (summary: ServerDamageSummary | null, ok = true) =>
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 200 : 500,
      json: () => Promise.resolve(summary ? { success: true, summary } : {}),
    });

  const setupServer = (initial: { isInCombat: boolean; messages: ChatMessage[] }) =>
    renderHook(
      (props: { isInCombat: boolean; messages: ChatMessage[] }) =>
        useDeferredCombatSummary({
          ...props,
          activeEncounter: props.isInCombat ? serverEncounter : null,
          sendMessage,
        }),
      { initialProps: initial },
    );

  const summaries = (): ChatMessage[] =>
    sendMessage.mock.calls
      .map(([message]) => message as ChatMessage)
      .filter((message) => message.text === 'Combat has ended.');

  const flushAsync = async () => {
    // The summary post awaits the damage-summary fetch; microtasks are not faked.
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    sendMessage.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('buildCombatSummaryMessageFromServer maps the server shape to the card shape', () => {
    const message = buildCombatSummaryMessageFromServer(serverSummary);
    expect(message.text).toBe('Combat has ended.');
    expect(message.context).toMatchObject({
      combatData: {
        type: 'summary',
        summary: {
          rounds: 1,
          totalDamage: 7,
          participants: [
            { name: 'The Sous Chef', damageDealt: 7, damageTaken: 0, status: 'ok' },
            { name: 'Proctor', damageDealt: 0, damageTaken: 7, status: 'dead' },
          ],
          outcome: 'Combat concluded',
        },
      },
    });
  });

  it('posts the server damage summary for a server-origin encounter', async () => {
    const fetchMock = fetchJson(serverSummary);
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = setupServer({ isInCombat: true, messages: [] });

    rerender({ isInCombat: false, messages: [dm('kill', true)] });
    await flushAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('/v1/combat/enc-1/damage-summary');
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0].context).toMatchObject({
      combatData: {
        type: 'summary',
        summary: {
          rounds: 1,
          totalDamage: 7,
          participants: [
            { name: 'The Sous Chef', damageDealt: 7, damageTaken: 0, status: 'ok' },
            { name: 'Proctor', damageDealt: 0, damageTaken: 7, status: 'dead' },
          ],
        },
      },
    });
  });

  it('falls back to the in-memory build when the damage-summary fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('network down')),
    );
    const { rerender } = setupServer({ isInCombat: true, messages: [] });

    rerender({ isInCombat: false, messages: [dm('kill', true)] });
    await flushAsync();

    // The in-memory encounter has no actions and full HP: the old all-zeros shape.
    expect(summaries()).toHaveLength(1);
    expect(summaries()[0].context).toMatchObject({
      combatData: { type: 'summary', summary: { rounds: 1, totalDamage: 0 } },
    });
  });

  it('does not fetch for a local (non-server) encounter', async () => {
    const fetchMock = fetchJson(serverSummary);
    vi.stubGlobal('fetch', fetchMock);
    const localEncounter = { ...serverEncounter, origin: 'local' } as CombatEncounter;
    const { rerender } = renderHook(
      (props: { isInCombat: boolean; messages: ChatMessage[] }) =>
        useDeferredCombatSummary({
          ...props,
          activeEncounter: props.isInCombat ? localEncounter : null,
          sendMessage,
        }),
      { initialProps: { isInCombat: true, messages: [] as ChatMessage[] } },
    );

    rerender({ isInCombat: false, messages: [dm('kill', true)] });
    await flushAsync();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(summaries()).toHaveLength(1);
  });
});
