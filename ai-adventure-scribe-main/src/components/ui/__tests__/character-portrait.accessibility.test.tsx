import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect } from 'vitest';

import { CharacterPortrait } from '../character-portrait';

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

  it('provides accessible labels and titles for character level', () => {
    render(<CharacterPortrait {...defaultProps} />);

    const levelBadge = screen.getByLabelText('Level 5');
    expect(levelBadge).toBeInTheDocument();
    expect(levelBadge).toHaveAttribute('title', 'Level 5');
  });

  it('provides accessible labels and titles for stats', () => {
    render(<CharacterPortrait {...defaultProps} />);

    const hpStat = screen.getByLabelText('HP: 40/50');
    expect(hpStat).toBeInTheDocument();
    expect(hpStat).toHaveAttribute('title', 'HP: 40/50');

    const acStat = screen.getByLabelText('Armor Class: 18');
    expect(acStat).toBeInTheDocument();
    expect(acStat).toHaveAttribute('title', 'Armor Class: 18');

    const initiativeStat = screen.getByLabelText('Initiative: +2');
    expect(initiativeStat).toBeInTheDocument();
    expect(initiativeStat).toHaveAttribute('title', 'Initiative: +2');
  });

  it('hides decorative icons from screen readers', () => {
    const { container } = render(<CharacterPortrait {...defaultProps} />);

    // Heart, Shield, and Zap icons should be aria-hidden
    const hiddenIcons = container.querySelectorAll('svg[aria-hidden="true"]');
    // Heart, Shield, Zap + potentially others (User if no image)
    expect(hiddenIcons.length).toBeGreaterThanOrEqual(3);
  });

  it('provides accessible labels for status effects', () => {
    render(<CharacterPortrait {...defaultProps} />);

    expect(screen.getByLabelText('Status: Blessed')).toBeInTheDocument();
    expect(screen.getByLabelText('Status: Inspired')).toBeInTheDocument();
  });
});
