/**
 * #2641 item 4 (run D9): when combat began, all ten earlier "What would you like to do?" groups in
 * the history were replaced by the combat menu (Attack, Dash, Dodge, End turn …).
 *
 * Every DM message with options mounted a `DynamicOptionsSection`, and that component swaps its
 * message's own options for the live legal-action menu whenever the *global* combat state is on.
 * Only the newest message should show the live menu; a past group is what the DM offered then.
 *
 * Real: MessageListContainer, MessageRenderer, DynamicOptionsSection, ActionOptions,
 * CombatProvider and the combat sync (DMMessage's voice wiring is not what is under test). Stubbed: `fetch` for `/active` and `/legal-actions`.
 */
import { act, render, screen } from '@testing-library/react';
import React, { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MessageListContainer } from '../MessageListContainer';

import type { ChatMessage } from '@/types/game';

import { CharacterProvider } from '@/contexts/CharacterContext';
import { CombatProvider } from '@/contexts/CombatContext';

vi.mock('@/contexts/GameContext', () => ({
  useGame: () => ({
    state: { diceRollQueue: { pendingRolls: [] }, currentPhase: 'exploration' },
    processAiResponse: vi.fn(),
  }),
}));
vi.mock('../use-message-dice-rolls', () => ({
  useMessageDiceRolls: () => ({
    currentRoll: null,
    batchProgress: null,
    rollRequest: null,
    handleManualResult: vi.fn(),
    handleCancelRoll: vi.fn(),
    lastRollRef: { current: null },
    pendingRollId: null,
    rollError: null,
  }),
}));
vi.mock('../DMMessage', () => ({
  DMMessage: ({ displayContent }: { displayContent: string }) => <p>{displayContent}</p>,
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/combat/use-player-roll-host', () => ({ usePlayerRollHost: vi.fn() }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test' })),
  getAccessToken: vi.fn(() => 'test'),
}));

const SESSION_ID = 'session-d9';

/** What the DM saves: prose, then a lettered option list `parseMessageOptions` reads back. */
const dmReply = (id: string, scene: string, options: [string, string, string]): ChatMessage => ({
  id,
  sender: 'dm',
  text:
    `${scene}\n\nWhat would you like to do?\n\n` +
    `A. **${options[0]}**, take it in.\nB. **${options[1]}**, press on.\n` +
    `C. **${options[2]}**, keep your distance.`,
});

const player = (id: string, text: string): ChatMessage => ({ id, sender: 'player', text });

const HISTORY: ChatMessage[] = [
  dmReply('dm-1', 'Water drips in the dark.', ['Listen to the abyss', 'Light a torch', 'Wait']),
  player('p-1', 'I listen.'),
  dmReply('dm-2', 'A ledge crumbles.', ['Search the ledge', 'Secure the items', 'Retreat']),
  player('p-2', 'I search.'),
  dmReply('dm-3', 'The chute opens below.', ['Descend into the chute', 'Climb back', 'Shout']),
];

/** The `combat` envelope `/active` returns and the socket broadcasts as combat_state_updated. */
const combatPayload = {
  encounter: {
    id: 'enc-1',
    sessionId: SESSION_ID,
    status: 'active',
    currentRound: 1,
    currentTurnOrder: 0,
    startedAt: '2026-10-06T23:40:00.000Z',
    endedAt: null,
    pendingIntent: null,
  },
  participants: [
    {
      id: 'pc-1',
      encounterId: 'enc-1',
      characterId: 'char-1',
      name: 'The Veteran',
      participantType: 'player',
      initiative: 21,
      initiativeModifier: 1,
      turnOrder: 0,
      isActive: true,
      armorClass: 18,
      maxHp: 12,
      speed: 30,
      conditions: [],
      vitalState: 'standing',
      status: { currentHp: 12, maxHp: 12, tempHp: 0, isConscious: true },
    },
    {
      id: 'npc-1',
      encounterId: 'enc-1',
      characterId: null,
      name: 'The Silent Monk 1',
      participantType: 'monster',
      initiative: 6,
      initiativeModifier: 0,
      turnOrder: 1,
      isActive: true,
      armorClass: 12,
      maxHp: 9,
      speed: 30,
      conditions: [],
      vitalState: 'standing',
      status: { currentHp: 9, maxHp: 9, tempHp: 0, isConscious: true },
    },
  ],
};

/** The legal-actions body the route returns for the player's turn. */
const legalActions = {
  actorId: 'pc-1',
  actions: [
    {
      type: 'attack',
      label: 'Attack with Crossbow, light',
      weaponId: 'crossbow',
      targetIds: ['npc-1'],
    },
    { type: 'dash', label: 'Dash' },
    { type: 'dodge', label: 'Dodge' },
    { type: 'end_turn', label: 'End turn' },
  ],
};

const list = (messages: ChatMessage[] = HISTORY): React.ReactElement => (
  <CharacterProvider>
    <CombatProvider sessionId={SESSION_ID}>
      <MessageListContainer
        messages={messages}
        messagesRef={createRef<HTMLDivElement>()}
        expandedMessages={new Set()}
        setExpandedMessages={vi.fn()}
        imageByMessage={{}}
        generatingFor={new Set()}
        genErrorByMessage={{}}
        onGenerateScene={vi.fn().mockResolvedValue(undefined)}
        onOptionSelect={vi.fn().mockResolvedValue(undefined)}
        onSendMessage={vi.fn().mockResolvedValue(undefined)}
        onSendFullMessage={vi.fn().mockResolvedValue(undefined)}
        sessionId={SESSION_ID}
        messagesReady
      />
    </CombatProvider>
  </CharacterProvider>
);

const settle = async (): Promise<void> => {
  // Twice: a re-render re-parses the options and restarts the show-after-delay timer.
  for (let pass = 0; pass < 2; pass += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(11_000);
    });
  }
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/legal-actions')) {
        return { ok: true, status: 200, json: async () => legalActions };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('past suggestion groups stay as the DM offered them when combat begins (#2641)', () => {
  it('keeps every earlier group and shows the combat menu once, on the newest message', async () => {
    render(list());
    await settle();
    for (const label of ['Listen to the abyss', 'Search the ledge', 'Descend into the chute']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    // The socket's frame when the fight starts: the browser is only told.
    act(() => {
      window.dispatchEvent(
        new CustomEvent('combat-state-updated', { detail: { combat: combatPayload } }),
      );
    });
    await settle();

    expect(screen.getByText('Listen to the abyss')).toBeInTheDocument();
    expect(screen.getByText('Light a torch')).toBeInTheDocument();
    expect(screen.getByText('Search the ledge')).toBeInTheDocument();
    expect(screen.getByText('Secure the items')).toBeInTheDocument();
    // Exactly one live menu, under the newest message.
    expect(screen.getAllByText('Dash')).toHaveLength(1);
    expect(screen.getAllByText('End turn')).toHaveLength(1);
    expect(screen.getAllByText('Attack with Crossbow, light')).toHaveLength(1);
  });

  it('shows the live menu at once under a notice row that follows the newest DM message', async () => {
    const withNoticeRow: ChatMessage[] = [
      ...HISTORY,
      {
        id: 'dm-notice',
        sender: 'dm',
        text: '(That was not a combat action — nothing was rolled. It is still your turn.)',
      },
    ];
    render(list(withNoticeRow));
    await settle();
    act(() => {
      window.dispatchEvent(
        new CustomEvent('combat-state-updated', { detail: { combat: combatPayload } }),
      );
    });
    // No timers advanced past the fetch: the player must not wait on the roleplay delay.
    for (let pass = 0; pass < 3; pass += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }

    expect(screen.getAllByText('Dash')).toHaveLength(1);
    expect(screen.getAllByText('End turn')).toHaveLength(1);
    expect(screen.getByText('Search the ledge')).toBeInTheDocument();
  });
});
