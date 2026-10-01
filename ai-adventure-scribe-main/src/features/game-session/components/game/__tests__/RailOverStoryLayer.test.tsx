import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ENEMY_FAILS_SAVE,
  FIGHT_ROSTER,
  REEVES,
  SCHOLAR,
  spellAction,
} from '../../../../../../shared/test-fixtures/engine-results';
import { RailOverStoryLayer } from '../game-content/RailOverStoryLayer';

import { formatCombatEngineParts } from '@/services/combat/combat-outcome-transcript';
import {
  askTargetSave,
  beginSheetCast,
  beginSheetCastCommit,
  finishSheetCast,
  reportSheetCastResult,
  resetSheetCastProgress,
} from '@/services/combat/sheet-cast-progress';
import {
  cancelPendingSpellTargetSave,
  setSpellTargetSaveHost,
} from '@/services/combat/spell-target-save-bridge';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const layer = () => screen.getByTestId('rail-over-story');

/**
 * #2418: under 768 px the rail is a bottom sheet in the story box. Its height, as a share of the
 * story box, follows the stage of the cast: idle 68%, casting 42%, Target saves 36%, result 58%.
 * jsdom has no layout, so this pins the contract; the measured heights are in the PR report.
 */
describe('RailOverStoryLayer bottom sheet (#2418)', () => {
  afterEach(() => cancelPendingSpellTargetSave());

  beforeEach(() => {
    resetSheetCastProgress();
    setSpellTargetSaveHost(null);
  });

  it('is in the story box’s flow, so the feed above it shrinks instead of being covered', () => {
    render(
      <RailOverStoryLayer onClose={vi.fn()}>
        <button type="button">Sheet</button>
      </RailOverStoryLayer>,
    );

    expect(layer()).toHaveClass('relative', 'shrink-0');
    expect(layer().className).not.toMatch(/\babsolute\b|\binset-0\b/);
  });

  it('takes 68% when idle, 42% while casting, 36% on the save card, and 58% for the result', async () => {
    render(
      <RailOverStoryLayer onClose={vi.fn()}>
        <button type="button">Sheet</button>
      </RailOverStoryLayer>,
    );
    expect(layer()).toHaveStyle({ height: '68%' });
    expect(layer()).toHaveAttribute('data-stage', 'idle');

    act(() => beginSheetCast('Acid Splash'));
    expect(layer()).toHaveStyle({ height: '42%' });
    expect(layer()).toHaveAttribute('data-stage', 'dm');

    setSpellTargetSaveHost({ present: () => () => {} });
    let asked: Promise<unknown> = Promise.resolve();
    act(() => {
      asked = askTargetSave(
        {
          actorLabel: 'The Scholar',
          targetLabel: 'Captain Sarah Reeves',
          spellName: 'Acid Splash',
          saveAbility: 'DEX',
        },
        true,
      );
    });
    expect(layer()).toHaveStyle({ height: '36%' });
    expect(layer()).toHaveAttribute('data-stage', 'save');
    void asked;

    act(() => {
      beginSheetCastCommit('Captain Sarah Reeves');
    });
    expect(layer()).toHaveStyle({ height: '42%' });
    expect(layer()).toHaveAttribute('data-stage', 'resolving');

    act(() => {
      reportSheetCastResult(
        formatCombatEngineParts(spellAction(SCHOLAR, REEVES), ENEMY_FAILS_SAVE, FIGHT_ROSTER)[0]
          .card,
      );
      finishSheetCast();
    });
    expect(layer()).toHaveStyle({ height: '58%' });
    expect(layer()).toHaveAttribute('data-stage', 'done');

    act(() => resetSheetCastProgress());
    expect(layer()).toHaveStyle({ height: '68%' });
  });

  it('keeps the idle height for the campaign rail while a cast runs', () => {
    act(() => {
      beginSheetCast('Acid Splash');
    });
    render(
      <RailOverStoryLayer onClose={vi.fn()} sizeByCast={false}>
        <button type="button">Campaign</button>
      </RailOverStoryLayer>,
    );

    expect(layer()).toHaveStyle({ height: '68%' });
  });

  it('keeps its focus and Escape behaviour', () => {
    const onClose = vi.fn();
    render(
      <RailOverStoryLayer onClose={onClose}>
        <button type="button">Sheet</button>
      </RailOverStoryLayer>,
    );

    expect(screen.getByRole('button', { name: 'Sheet' })).toHaveFocus();
    screen
      .getByRole('button', { name: 'Sheet' })
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
