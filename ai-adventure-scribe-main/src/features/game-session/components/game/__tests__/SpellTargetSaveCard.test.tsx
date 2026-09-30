import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SpellTargetSaveCard } from '../SpellTargetSaveCard';

describe('SpellTargetSaveCard', () => {
  it('shows a target-saves card with no player roll and continues on Continue', () => {
    const onContinue = vi.fn();

    render(
      <SpellTargetSaveCard
        pending={{
          spec: {
            actorLabel: 'Rook',
            targetLabel: 'Professor Umeboshi',
            spellName: 'Acid Splash',
            saveAbility: 'DEX',
          },
          continue: onContinue,
        }}
      />,
    );

    expect(screen.getByTestId('spell-target-save-card')).toBeInTheDocument();
    expect(screen.getByText('Target saves')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Professor Umeboshi must make a DEX saving throw against Acid Splash. You do not roll.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/1d20/i)).not.toBeInTheDocument();
    // The player already pressed Cast; the card's button carries on, it does not cast again (#2392).
    expect(screen.queryByRole('button', { name: /cast/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it('resolves a raw slug target through the shared display-name module (#2343 B4)', () => {
    render(
      <SpellTargetSaveCard
        pending={{
          spec: {
            actorLabel: 'Rook',
            targetLabel: 'shimmering-spore-shape-1',
            spellName: 'Acid Splash',
            saveAbility: 'DEX',
          },
          continue: vi.fn(),
        }}
        roster={[{ id: 'shimmering-spore-shape-1', name: 'shimmering-spore-shape-1' }]}
      />,
    );

    expect(
      screen.getByText(
        'Shimmering Spore Shape 1 must make a DEX saving throw against Acid Splash. You do not roll.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/shimmering-spore-shape-1/)).not.toBeInTheDocument();
  });

  it('prefers the roster name over the raw label (#2343 B4)', () => {
    render(
      <SpellTargetSaveCard
        pending={{
          spec: {
            actorLabel: 'Rook',
            targetLabel: 'shimmering-spore-shape-1',
            spellName: 'Acid Splash',
            saveAbility: 'DEX',
          },
          continue: vi.fn(),
        }}
        roster={[{ id: 'shimmering-spore-shape-1', name: 'Shimmering Spore-Shape' }]}
      />,
    );

    expect(
      screen.getByText(
        'Shimmering Spore-Shape must make a DEX saving throw against Acid Splash. You do not roll.',
      ),
    ).toBeInTheDocument();
  });

  it('resolves a slug label to the roster name when the roster id is a uuid (#2343 B4, run 16)', () => {
    render(
      <SpellTargetSaveCard
        pending={{
          spec: {
            actorLabel: 'Rook',
            targetLabel: 'captain-sarah-reeves',
            spellName: 'Fireball',
            saveAbility: 'DEX',
          },
          continue: vi.fn(),
        }}
        roster={[
          {
            id: 'a3f1c2d4-1234-4abc-8def-0123456789ab',
            name: 'Captain Sarah Reeves',
          },
        ]}
      />,
    );

    expect(
      screen.getByText(
        'Captain Sarah Reeves must make a DEX saving throw against Fireball. You do not roll.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/captain-sarah-reeves/)).not.toBeInTheDocument();
  });
});
