import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { PlayableCharacterCard } from '../PlayableCharacterCard';

import type { Character } from '@/features/campaign/hooks/use-character-selection';

const getModifier = (score?: number): string => {
  if (!score) return '+0';
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
};

const claudeStats = {
  strength: 17,
  dexterity: 17,
  constitution: 17,
  intelligence: 18,
  wisdom: 16,
  charisma: 8,
  armor_class: 13,
  max_hit_points: 11,
};

const baseCharacter: Character = {
  id: '274de914-ad42-49fa-b038-8e458cf9980a',
  name: 'Claude',
  race: 'Forest Giant',
  class: 'Monk',
  level: 1,
};

const renderCard = (character: Character): void => {
  render(
    <PlayableCharacterCard character={character} onSelect={vi.fn()} getModifier={getModifier} />,
  );
};

describe('PlayableCharacterCard', () => {
  it('renders stored ability and combat stats from the array payload', () => {
    renderCard({
      ...baseCharacter,
      character_stats: [claudeStats],
    } as Character);

    expect(screen.getByLabelText('Quick stats')).toHaveTextContent('HP:11');
    expect(screen.getByLabelText('Quick stats')).toHaveTextContent('AC:13');
    expect(screen.getByLabelText('Strength modifier: +3')).toBeInTheDocument();
    expect(screen.getByLabelText('Dexterity modifier: +3')).toBeInTheDocument();
    expect(screen.getByLabelText('Constitution modifier: +3')).toBeInTheDocument();
    expect(screen.getByLabelText('Intelligence modifier: +4')).toBeInTheDocument();
    expect(screen.getByLabelText('Wisdom modifier: +3')).toBeInTheDocument();
    expect(screen.getByLabelText('Charisma modifier: -1')).toBeInTheDocument();
    expect(screen.queryByLabelText('Strength modifier: +0')).not.toBeInTheDocument();
  });

  it('uses the neutral placeholder instead of The Lost Temple art when the character has no cover', () => {
    renderCard(baseCharacter);

    const banner = document.querySelector('[aria-hidden="true"].relative.h-32') as HTMLElement;
    expect(banner.style.backgroundImage).toContain('/card-placeholder.svg');
    expect(banner.style.backgroundImage).not.toContain('card-background.jpeg');
  });

  it('hides the stats block when the stats array is empty', () => {
    renderCard({
      ...baseCharacter,
      character_stats: [],
    } as Character);

    expect(screen.queryByLabelText('Quick stats')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/modifier:/)).not.toBeInTheDocument();
  });
});
