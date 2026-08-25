import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import CharacterCardHoverContent from '../CharacterCardHoverContent';

const renderHoverContent = (character_stats: Array<Record<string, number>>): void => {
  render(
    <CharacterCardHoverContent
      character={{
        id: 'character-123',
        name: 'The Storyteller',
        level: 3,
        character_stats,
      }}
      isHovered={true}
      imageLoading={false}
      onPlay={vi.fn()}
      onViewDetails={vi.fn()}
      onDelete={vi.fn()}
    />,
  );
};

describe('CharacterCardHoverContent', () => {
  it('renders stored ability and combat stats from the array payload', () => {
    renderHoverContent([
      {
        strength: 8,
        dexterity: 14,
        constitution: 12,
        intelligence: 14,
        wisdom: 12,
        charisma: 18,
        max_hit_points: 10,
        current_hit_points: 7,
        armor_class: 15,
      },
    ]);

    expect(screen.getByText('8 (-1)')).toBeInTheDocument();
    expect(screen.getAllByText('14 (+2)')).toHaveLength(2);
    expect(screen.getByText('18 (+4)')).toBeInTheDocument();
    expect(screen.getByText('HP:').parentElement).toHaveTextContent('7/10');
    expect(screen.getByText('AC:').parentElement).toHaveTextContent('15');
    expect(screen.queryByText('10 (+0)')).not.toBeInTheDocument();
  });

  it('falls back to default ability scores when the stats array is empty', () => {
    renderHoverContent([]);

    expect(screen.getAllByText('10 (+0)')).toHaveLength(6);
    expect(screen.queryByText(/HP:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/AC:/)).not.toBeInTheDocument();
  });

  it('renders stored zero current HP instead of falling back to max HP', () => {
    renderHoverContent([{ max_hit_points: 10, current_hit_points: 0 }]);

    expect(screen.getByText('HP:').parentElement).toHaveTextContent('0/10');
  });
});
