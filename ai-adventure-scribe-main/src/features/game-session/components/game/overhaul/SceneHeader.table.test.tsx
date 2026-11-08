import { fireEvent, render, screen } from '@testing-library/react';
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

  it('shows a resized portrait and falls back if it fails', () => {
    render(
      <SceneHeader
        title="The Chasm"
        party={[
          {
            id: 'hero',
            name: 'Hero',
            subtitle: 'Fighter',
            currentHp: 8,
            maxHp: 12,
            avatarUrl: new URL('/storage/v1/object/public/portraits/hero.png', window.location.href)
              .href,
          },
        ]}
        combat={{
          active: true,
          round: 2,
          combatants: [
            { id: 'hero', name: 'Hero', initiative: 18, isActive: true },
            { id: 'foe', name: 'Spider', initiative: 14, isEnemy: true },
          ],
        }}
      />,
    );
    expect(screen.getByRole('presentation', { hidden: true })).toHaveAttribute(
      'src',
      expect.stringContaining('/storage/v1/render/image/public/'),
    );
    fireEvent.error(screen.getByRole('presentation', { hidden: true }));
    expect(screen.queryByRole('presentation', { hidden: true })).not.toBeInTheDocument();
    expect(screen.getByText('H')).toBeInTheDocument();
  });

  it('shows only an engine-supplied foe tier', () => {
    render(
      <SceneHeader
        title="The Chasm"
        combat={{
          active: true,
          round: 1,
          combatants: [
            {
              id: 'foe',
              name: 'Spider',
              initiative: 10,
              isEnemy: true,
              healthCondition: 'bloodied',
            },
            { id: 'unknown', name: 'Wraith', initiative: 8, isEnemy: true },
          ],
        }}
      />,
    );
    expect(screen.getByText('Spider · bloodied')).toBeInTheDocument();
    expect(screen.getByText('Wraith · condition unavailable')).toBeInTheDocument();
  });

  it('uses the location outside combat', () => {
    render(<SceneHeader title="The Chasm" location="Rope Ledge" />);
    expect(screen.getByText('Exploring')).toBeInTheDocument();
    expect(screen.getByText('Rope Ledge')).toBeInTheDocument();
  });
});
