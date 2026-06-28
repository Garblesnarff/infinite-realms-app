import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect } from 'vitest';

import { CharacterPortrait } from '../character-portrait';
import { TooltipProvider } from '../tooltip';

describe('CharacterPortrait Accessibility', () => {
  const defaultProps = {
    name: 'Thorin',
    level: 5,
    hp: 40,
    maxHp: 50,
    ac: 18,
    initiative: 2,
    showStats: true,
    status: ['Blessed', 'Inspired'],
  };

  it('provides accessible labels for character level and removes native title', () => {
    render(
      <TooltipProvider>
        <CharacterPortrait {...defaultProps} />
      </TooltipProvider>,
    );

    const levelBadge = screen.getByLabelText('Level 5');
    expect(levelBadge).toBeInTheDocument();
    expect(levelBadge).not.toHaveAttribute('title');
  });

  it('provides accessible labels for stats and removes native titles', () => {
    render(
      <TooltipProvider>
        <CharacterPortrait {...defaultProps} />
      </TooltipProvider>,
    );

    const hpStat = screen.getByLabelText('HP: 40/50');
    expect(hpStat).toBeInTheDocument();
    expect(hpStat).not.toHaveAttribute('title');

    const acStat = screen.getByLabelText('Armor Class: 18');
    expect(acStat).toBeInTheDocument();
    expect(acStat).not.toHaveAttribute('title');

    const initiativeStat = screen.getByLabelText('Initiative: +2');
    expect(initiativeStat).toBeInTheDocument();
    expect(initiativeStat).not.toHaveAttribute('title');
  });

  it('hides decorative icons from screen readers', () => {
    const { container } = render(
      <TooltipProvider>
        <CharacterPortrait {...defaultProps} />
      </TooltipProvider>,
    );

    // Heart, Shield, and Zap icons should be aria-hidden
    const hiddenIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    // Heart, Shield, Zap + potentially others (User if no image)
    expect(hiddenIcons.length).toBeGreaterThanOrEqual(3);
  });

  it('provides accessible labels for status effects', () => {
    render(
      <TooltipProvider>
        <CharacterPortrait {...defaultProps} />
      </TooltipProvider>,
    );

    expect(screen.getByLabelText('Status: Blessed')).toBeInTheDocument();
    expect(screen.getByLabelText('Status: Inspired')).toBeInTheDocument();
  });
});
