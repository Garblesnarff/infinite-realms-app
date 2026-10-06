import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DYING_SCHOLAR_ENCOUNTER,
  DYING_SCHOLAR_PARTICIPANT,
} from '../../../../../../../shared/test-fixtures/dying-participant-wire';
import { DEATH_SAVE_TURN_TEXT, DyingComposerSlot } from '../DyingComposerSlot';

import { mapAuthoritativeCombat } from '@/contexts/combat/authoritative-combat-state';
import { useOptionalCombat } from '@/contexts/CombatContext';

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
  beforeEach(() => vi.clearAllMocks());

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

  it('the panel’s Roll button is the retry when a turn did not complete', async () => {
    useCombatNow(board({ holder: 'scholar' }));
    const { onSendMessage } = renderSlot();
    expect(onSendMessage).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent.click(screen.getByTestId('dying-panel-roll'));
    });
    expect(onSendMessage).toHaveBeenCalledTimes(2);
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
