import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../../../../../../../shared/test-fixtures/dying-participant-wire';
import { DEATH_SAVE_TURN_TEXT, DyingComposerSlot } from '../DyingComposerSlot';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { useOptionalCombat } from '@/contexts/CombatContext';
import {
  markDeathSavePromptDismissed,
  requestPlayerDeathSaveRoll,
  setPlayerRollHost,
  settlePendingPlayerRoll,
} from '@/services/combat/player-roll-bridge';

vi.mock('@/contexts/CombatContext', () => ({ useOptionalCombat: vi.fn() }));

const SPIDER_ID = '99999999-1111-4222-8333-444444444444';
const spiderWire = {
  ...DYING_SCHOLAR_PARTICIPANT,
  id: SPIDER_ID,
  characterId: null,
  name: 'Vitruvian Spider',
  participantType: 'monster',
  turnOrder: 1,
  maxHp: 40,
  status: {
    ...DYING_SCHOLAR_PARTICIPANT.status,
    participantId: SPIDER_ID,
    currentHp: 40,
    maxHp: 40,
    isConscious: true,
    deathSavesFailures: 0,
  },
  vitalState: 'standing',
};

/** The board as the client holds it, mapped by the real hydration from the server's wire shape. */
const board = (options: {
  holder?: 'scholar' | 'spider';
  round?: number;
  scholar?: Record<string, unknown>;
  phase?: 'active' | 'completed';
}) =>
  mapAuthoritativeCombat({
    encounter: {
      ...DYING_SCHOLAR_ENCOUNTER,
      status: options.phase ?? 'active',
      currentRound: options.round ?? 3,
      currentTurnOrder: (options.holder ?? 'scholar') === 'scholar' ? 0 : 1,
    },
    participants: [options.scholar ?? DYING_SCHOLAR_PARTICIPANT, spiderWire],
  } as never);

const useCombatNow = (encounter: ReturnType<typeof board> | null) =>
  vi.mocked(useOptionalCombat).mockReturnValue({
    state: { isInCombat: encounter !== null, activeEncounter: encounter },
  } as never);

const renderSlot = (props: Partial<React.ComponentProps<typeof DyingComposerSlot>> = {}) => {
  const onSendMessage = vi.fn().mockResolvedValue(undefined);
  const view = render(
    <DyingComposerSlot
      onSendMessage={onSendMessage}
      isProcessing={false}
      promptOpen={false}
      {...props}
    >
      <textarea data-testid="composer" />
    </DyingComposerSlot>,
  );
  return { onSendMessage, ...view };
};

describe('DyingComposerSlot (#2518)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    settlePendingPlayerRoll({ d20: null });
    setPlayerRollHost(null);
  });

  it('replaces the composer with the dying panel: there is nothing to type into', () => {
    useCombatNow(board({ holder: 'spider' }));
    renderSlot();

    expect(screen.queryByTestId('composer')).toBeNull();
    expect(screen.getByTestId('dying-panel')).toBeTruthy();
    expect(screen.getByTestId('dying-panel-failures').textContent).toContain('✕✕○');
  });

  it('starts the dying turn on its own when the order reaches the player at 0 HP, once', () => {
    useCombatNow(board({ holder: 'scholar' }));
    const { onSendMessage, rerender } = renderSlot();

    expect(onSendMessage).toHaveBeenCalledTimes(1);
    expect(onSendMessage).toHaveBeenCalledWith(DEATH_SAVE_TURN_TEXT, { intent: 'death_save_turn' });
    // A re-render of the same turn (a roll tray opening, a refresh) never sends it again.
    rerender(
      <DyingComposerSlot onSendMessage={onSendMessage} isProcessing={false} promptOpen>
        <textarea data-testid="composer" />
      </DyingComposerSlot>,
    );
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('waits for the turn in flight to finish before sending the next one', () => {
    useCombatNow(board({ holder: 'scholar' }));
    const { onSendMessage, rerender } = renderSlot({ isProcessing: true });
    expect(onSendMessage).not.toHaveBeenCalled();

    rerender(
      <DyingComposerSlot onSendMessage={onSendMessage} isProcessing={false} promptOpen={false}>
        <textarea data-testid="composer" />
      </DyingComposerSlot>,
    );
    expect(onSendMessage).toHaveBeenCalledTimes(1);
  });

  it('never sends on another participant’s turn while the player is dying', () => {
    // The death save belongs to the player's own turn. Sending on the spider's turn
    // dispatched a spurious out-of-turn save every round.
    useCombatNow(board({ holder: 'spider' }));
    const { onSendMessage, rerender } = renderSlot();
    expect(onSendMessage).not.toHaveBeenCalled();
    // A re-render on the same foreign turn still sends nothing.
    rerender(
      <DyingComposerSlot onSendMessage={onSendMessage} isProcessing={false} promptOpen={false}>
        <textarea data-testid="composer" />
      </DyingComposerSlot>,
    );
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('sends again for the next round: a new round is a new save', () => {
    useCombatNow(board({ holder: 'scholar', round: 3 }));
    const { onSendMessage, rerender } = renderSlot();
    expect(onSendMessage).toHaveBeenCalledTimes(1);

    useCombatNow(board({ holder: 'scholar', round: 4 }));
    rerender(
      <DyingComposerSlot onSendMessage={onSendMessage} isProcessing={false} promptOpen={false}>
        <textarea data-testid="composer" />
      </DyingComposerSlot>,
    );
    expect(onSendMessage).toHaveBeenCalledTimes(2);
  });

  it('the panel’s Roll button is hidden while the auto-send is in flight: no duplicate turn', async () => {
    useCombatNow(board({ holder: 'scholar' }));
    // The send takes a moment; during that window the old button dispatched a duplicate
    // turn the server refused (#261 CB-025).
    let resolveSend!: () => void;
    const slowSend = vi.fn(() => new Promise<void>((resolve) => { resolveSend = resolve; }));
    renderSlot({ onSendMessage: slowSend });
    expect(slowSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('dying-panel-roll')).toBeNull();
    await act(async () => { resolveSend(); });
    expect(slowSend).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('dying-panel-roll')).toBeNull();
  });

  it('the panel’s Roll button is the retry when the auto-send failed', async () => {
    useCombatNow(board({ holder: 'scholar' }));
    const failingSend = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    renderSlot({ onSendMessage: failingSend });
    expect(failingSend).toHaveBeenCalledTimes(1);

    // The failed send brings the button back as the retry path.
    await screen.findByTestId('dying-panel-roll');
    await act(async () => {
      fireEvent.click(screen.getByTestId('dying-panel-roll'));
    });
    expect(failingSend).toHaveBeenCalledTimes(2);
    // The retry succeeded: the button is gone again, not a second roller.
    expect(screen.queryByTestId('dying-panel-roll')).toBeNull();
  });

  it('after the death-save prompt is dismissed the Roll button stays so the player can roll when ready', async () => {
    // The bridge holds the waiting death-save prompt with its 45 s timer running; the
    // player dismissed the popup (RG-019: dismiss alone never rolls).
    const present = vi.fn(() => ({ rollId: 'death-roll-1', dismiss: vi.fn() }));
    setPlayerRollHost({ present });
    const pendingRoll = requestPlayerDeathSaveRoll({ actorLabel: 'The Scholar' });
    markDeathSavePromptDismissed();

    useCombatNow(board({ holder: 'scholar' }));
    const { onSendMessage } = renderSlot({ promptOpen: false });

    // The auto-send still went out once for the turn; the button is not a second send.
    expect(onSendMessage).toHaveBeenCalledTimes(1);
    const rollButton = await screen.findByTestId('dying-panel-roll');
    expect(rollButton).toBeTruthy();

    // Clicking it re-opens the waiting prompt; the turn is not sent again.
    await act(async () => {
      fireEvent.click(rollButton);
    });
    expect(present).toHaveBeenCalledTimes(2);
    expect(onSendMessage).toHaveBeenCalledTimes(1);

    settlePendingPlayerRoll({ d20: 10 });
    await pendingRoll;
  });

  it('a player on their feet keeps the composer and sends nothing', () => {
    useCombatNow(
      board({
        scholar: {
          ...DYING_SCHOLAR_PARTICIPANT,
          vitalState: 'standing',
          status: {
            ...DYING_SCHOLAR_PARTICIPANT.status,
            currentHp: 7,
            isConscious: true,
            deathSavesFailures: 0,
          },
        },
      }),
    );
    const { onSendMessage } = renderSlot();

    expect(screen.getByTestId('composer')).toBeTruthy();
    expect(screen.queryByTestId('dying-panel')).toBeNull();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('a stable player gets the stable panel and no save to roll', () => {
    useCombatNow(
      board({
        holder: 'spider',
        scholar: {
          ...DYING_SCHOLAR_PARTICIPANT,
          vitalState: 'stabilized',
          status: {
            ...DYING_SCHOLAR_PARTICIPANT.status,
            deathSavesSuccesses: 3,
            deathSavesFailures: 0,
          },
        },
      }),
    );
    const { onSendMessage } = renderSlot();

    expect(screen.getByTestId('dying-panel-title').textContent).toContain('is stable');
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('once the fight has ended the composer is back (the woken hero is on their feet)', () => {
    useCombatNow(null);
    const { onSendMessage } = renderSlot();

    expect(screen.getByTestId('composer')).toBeTruthy();
    expect(onSendMessage).not.toHaveBeenCalled();
  });

  it('renders the composer when no combat provider is mounted', () => {
    vi.mocked(useOptionalCombat).mockReturnValue(undefined);
    renderSlot();

    expect(screen.getByTestId('composer')).toBeTruthy();
  });
});
