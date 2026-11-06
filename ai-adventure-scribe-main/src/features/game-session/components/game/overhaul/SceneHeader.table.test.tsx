import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SceneHeader } from './SceneHeader';

describe('Table scene plaque', () => {
  it('shows the live party HP and current combatant', () => {
    render(
      <SceneHeader
        title="The Chasm"
        chapter="Session 1"
        party={[{ id: 'hero', name: 'Hero', subtitle: 'Fighter', currentHp: 8, maxHp: 12 }]}
        combat={{
          active: true,
          round: 2,
          combatants: [{ id: 'foe', name: 'Spider', initiative: 14, isActive: true }],
        }}
      />,
    );
    expect(screen.getByText('Round 2')).toBeInTheDocument();
    expect(screen.getByText('Spider')).toBeInTheDocument();
    expect(screen.getByText('8 / 12')).toBeInTheDocument();
  });

  it('uses the location outside combat', () => {
    render(<SceneHeader title="The Chasm" location="Rope Ledge" />);
    expect(screen.getByText('Exploring')).toBeInTheDocument();
    expect(screen.getByText('Rope Ledge')).toBeInTheDocument();
  });
});
