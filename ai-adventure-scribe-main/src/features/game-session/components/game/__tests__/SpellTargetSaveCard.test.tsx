import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SpellTargetSaveCard } from '../SpellTargetSaveCard';

describe('SpellTargetSaveCard', () => {
  it('shows a target-saves card with no player roll and continues on Cast', () => {
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
    fireEvent.click(screen.getByRole('button', { name: '[Cast]' }));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
