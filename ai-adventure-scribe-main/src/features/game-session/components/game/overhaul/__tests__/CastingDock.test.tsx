import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENEMY_FAILS_SAVE,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../../../../../shared/test-fixtures/engine-results';
import { CastingDock, castStatusText } from '../CastingDock';

import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';
import {
  beginSheetCast,
  beginSheetCastCommit,
  cancelSheetCast,
  finishSheetCast,
  getSheetCastSnapshot,
  reportSheetCastResult,
  resetSheetCastProgress,
  sheetCastCancelled,
  withSheetCastRoll,
} from '@/services/combat/sheet-cast-progress';

/** The card the real producer builds for the player's save spell that the target fails. */
const engineSpellCard = () =>
  formatCombatEngineParts(spellAction(SCHOLAR, REEVES), ENEMY_FAILS_SAVE, FIGHT_ROSTER)[0].card;

const advance = (seconds: number): void => {
  act(() => {
    vi.advanceTimersByTime(seconds * 1000);
  });
};

const status = (): string => screen.getByRole('status').textContent ?? '';

describe('CastingDock (#2418)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-01T20:00:00Z'));
    resetSheetCastProgress();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetSheetCastProgress();
    window.localStorage.clear();
  });

  it('shows nothing when no cast is running', () => {
    render(<CastingDock />);

    expect(screen.queryByTestId('casting-dock')).not.toBeInTheDocument();
  });

  it('names the spell, and its status line is a polite live region', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));

    expect(screen.getByRole('heading', { name: 'Casting Acid Splash' })).toBeInTheDocument();
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent('Sending your spell to the DM');
  });

  it('changes the status at 5 s and 20 s, and counts the elapsed time from 5 s', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));

    advance(4);
    expect(status()).toBe('Sending your spell to the DM');
    expect(screen.queryByTestId('casting-elapsed')).not.toBeInTheDocument();

    advance(1);
    expect(status()).toBe('The DM is reading the scene.');
    expect(screen.getByTestId('casting-elapsed')).toHaveTextContent('5 s');

    advance(7);
    expect(screen.getByTestId('casting-elapsed')).toHaveTextContent('12 s');
    expect(status()).toBe('The DM is reading the scene.');

    advance(8);
    expect(status()).toBe('The DM is reading the scene. This can take up to a minute.');
    expect(screen.getByTestId('casting-elapsed')).toHaveTextContent('20 s');
  });

  it('follows the spec copy for the other phases', () => {
    const base = { spellName: 'Acid Splash', phaseStartedAt: 0, cancellable: true } as const;

    expect(castStatusText({ ...base, phase: 'save' }, 3)).toBe('Press Continue below.');
    expect(
      castStatusText({ ...base, phase: 'resolving', targetName: 'Captain Sarah Reeves' }, 4),
    ).toBe('Rolling for Captain Sarah Reeves');
    expect(
      castStatusText({ ...base, phase: 'resolving', targetName: 'Captain Sarah Reeves' }, 10),
    ).toBe('The DM is writing what happens.');
    expect(castStatusText({ ...base, phase: 'resolving' }, 25)).toBe(
      'The DM is writing what happens. This can take up to a minute.',
    );
  });

  it('draws an indeterminate bar that stands still under reduced motion', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));

    const moving = screen.getByTestId('casting-dock').querySelector('.animate-cast-indeterminate');
    expect(moving).not.toBeNull();
    // No percentage: it is not a progressbar, and the screen reader hears the status line instead.
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(moving).toHaveClass('motion-reduce:animate-none');
    expect(moving!.parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('lists the steps Sent · Save · Result and says which one is now', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));

    const steps = screen.getAllByRole('listitem').map((item) => item.textContent);
    expect(steps).toEqual(['Sent, done', 'Save, waiting', 'Result, waiting']);

    act(() => {
      beginSheetCastCommit('Captain Sarah Reeves');
    });
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Sent, done',
      'Save, done',
      'Result, now',
    ]);
  });

  it('offers Keep waiting and Cancel cast at 60 s, and Keep waiting hides them for another minute', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));

    advance(59);
    expect(screen.queryByText('This is taking too long.')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByText('This is taking too long.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel cast' })).toHaveClass('h-11');

    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(screen.queryByText('This is taking too long.')).not.toBeInTheDocument();
    advance(59);
    expect(screen.queryByText('This is taking too long.')).not.toBeInTheDocument();
    advance(1);
    expect(screen.getByText('This is taking too long.')).toBeInTheDocument();
  });

  it('says the die is waiting for the player, and does not time that wait as the DM’s', async () => {
    render(<CastingDock />);
    act(() => {
      beginSheetCast('Chill Touch');
    });
    await act(async () => {
      void withSheetCastRoll(true, () => new Promise<void>(() => {}));
    });

    expect(status()).toBe('Roll your die below.');
    advance(90);
    expect(screen.queryByText('This is taking too long.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('casting-elapsed')).not.toBeInTheDocument();
  });

  it('Cancel cast gives the cast up: the dock clears and the DM call is told to stop', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));
    advance(60);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel cast' }));

    expect(screen.queryByTestId('casting-dock')).not.toBeInTheDocument();
    expect(sheetCastCancelled()).toBe(true);
    // A commit after a cancel is refused: the engine never spends the slot.
    expect(beginSheetCastCommit()).toBe(false);
  });

  it('offers no Cancel once the engine holds the cast: the slot is spent and stays spent', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));
    act(() => {
      beginSheetCastCommit('Captain Sarah Reeves');
    });
    advance(60);

    expect(screen.getByText('This is taking too long.')).toBeInTheDocument();
    expect(
      screen.getByText('The spell has already resolved, so it cannot be cancelled.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel cast' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep waiting' })).toBeInTheDocument();
    expect(cancelSheetCast()).toBe(false);
    expect(getSheetCastSnapshot().cast?.phase).toBe('resolving');
  });

  it('shows the result with its badge and a Dismiss button, then clears', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));
    act(() => {
      beginSheetCastCommit('Captain Sarah Reeves');
      reportSheetCastResult(engineSpellCard());
      finishSheetCast();
    });

    expect(screen.getByText('TARGET FAILED')).toBeInTheDocument();
    expect(status()).toBe(
      'DEX save 6 vs DC 14 · 2 acid damage. Captain Sarah Reeves is now at 9 HP.',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('casting-dock')).not.toBeInTheDocument();
  });

  it('shows one result per target of an area cast', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));
    act(() => {
      beginSheetCastCommit('Captain Sarah Reeves');
      reportSheetCastResult(engineSpellCard());
      reportSheetCastResult(engineSpellCard());
      finishSheetCast();
    });

    expect(screen.getAllByText('TARGET FAILED')).toHaveLength(2);
  });

  it('moves focus out of the dock, not to the page, when the pressed button goes away', () => {
    const { container } = render(
      <div tabIndex={-1} data-testid="sheet">
        <CastingDock />
      </div>,
    );
    act(() => beginSheetCast('Acid Splash'));
    advance(60);

    fireEvent.click(screen.getByRole('button', { name: 'Keep waiting' }));
    expect(screen.getByTestId('casting-dock')).toHaveFocus();

    advance(60);
    screen.getByRole('button', { name: 'Cancel cast' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel cast' }));
    expect(container.querySelector('[data-testid="sheet"]')).toHaveFocus();
    expect(document.body).not.toHaveFocus();
  });

  it('leaves the DC out of the result when "Show target numbers" is off', () => {
    window.localStorage.setItem('ui:showTargetNumbers:v1', 'off');
    render(<CastingDock />);
    act(() => beginSheetCast('Acid Splash'));
    act(() => {
      beginSheetCastCommit('Captain Sarah Reeves');
      reportSheetCastResult(engineSpellCard());
      finishSheetCast();
    });

    expect(status()).toBe('DEX save 6 · 2 acid damage. Captain Sarah Reeves is now at 9 HP.');
  });

  it('clears at once when the cast ends with no engine card (a cast outside combat)', () => {
    render(<CastingDock />);
    act(() => beginSheetCast('Light'));
    act(() => finishSheetCast());

    expect(screen.queryByTestId('casting-dock')).not.toBeInTheDocument();
  });
});
