import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { StarterCharacterCard, getClassIcon } from '../StarterCharacterCard';
import { StarterCharacterDetails, getModifier } from '../StarterCharacterDetails';

import type { StarterCharacterTemplate } from '@/hooks/use-starter-character-templates';

const mockTemplate: StarterCharacterTemplate = {
  id: 'test-id',
  name: 'Valerius the Brave',
  race: 'Human',
  class: 'Fighter',
  tagline: 'A veteran of a hundred battles.',
  portraitUrl: 'https://example.com/portrait.png',
  abilityScores: {
    strength: 16,
    dexterity: 14,
    constitution: 15,
    intelligence: 10,
    wisdom: 12,
    charisma: 8,
  },
  personality: {
    traits: ['Brave', 'Loyal'],
    ideals: 'Protect the weak',
    bonds: 'My sword is my life',
    flaws: 'Quick to anger',
  },
  skills: ['Athletics', 'Perception'],
  languages: ['Common'],
  adaptedBackstory: 'Grew up in the city of Neverwinter...',
  campaignHook: 'Sent by the Lord of Neverwinter to investigate...',
};

describe('StarterCharacterCard Accessibility', () => {
  it('renders with correct ARIA attributes when selected', () => {
    render(
      <StarterCharacterCard
        template={mockTemplate}
        isSelected={true}
        onSelect={vi.fn()}
      />
    );

    const button = screen.getByRole('button', {
      name: /Select Valerius the Brave, Human Fighter/i,
    });

    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveAttribute('title', 'Select Valerius the Brave, Human Fighter');

    // Check for the selection checkmark (aria-hidden)
    const checkmark = button.querySelector('svg[aria-hidden="true"]');
    expect(checkmark).toBeInTheDocument();
  });

  it('renders with correct ARIA attributes when not selected', () => {
    render(
      <StarterCharacterCard
        template={mockTemplate}
        isSelected={false}
        onSelect={vi.fn()}
      />
    );

    const button = screen.getByRole('button', {
      name: /Select Valerius the Brave, Human Fighter/i,
    });

    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('StarterCharacterDetails Accessibility', () => {
  it('renders ability scores with correct group roles and labels', () => {
    render(<StarterCharacterDetails template={mockTemplate} />);

    // Strength: 16, modifier +3
    const strengthGroup = screen.getByRole('group', {
      name: /strength: 16, modifier \+3/i,
    });
    expect(strengthGroup).toBeInTheDocument();
    expect(strengthGroup).toHaveAttribute('title', 'strength: 16, modifier +3');

    // Check that internal texts are hidden from screen readers to avoid redundancy
    const internalTexts = strengthGroup.querySelectorAll('[aria-hidden="true"]');
    expect(internalTexts.length).toBeGreaterThanOrEqual(3);

    // Charisma: 8, modifier -1
    const charismaGroup = screen.getByRole('group', {
      name: /charisma: 8, modifier -1/i,
    });
    expect(charismaGroup).toBeInTheDocument();
    expect(charismaGroup).toHaveAttribute('title', 'charisma: 8, modifier -1');
  });

  it('correctly calculates modifiers with getModifier', () => {
    expect(getModifier(10)).toBe('+0');
    expect(getModifier(11)).toBe('+0');
    expect(getModifier(12)).toBe('+1');
    expect(getModifier(13)).toBe('+1');
    expect(getModifier(8)).toBe('-1');
    expect(getModifier(9)).toBe('-1');
    expect(getModifier(18)).toBe('+4');
    expect(getModifier(5)).toBe('-3');
  });
});

describe('getClassIcon', () => {
  it('returns icons for various classes', () => {
    render(<>{getClassIcon('Fighter')}</>);
    render(<>{getClassIcon('Cleric')}</>);
    render(<>{getClassIcon('Wizard')}</>);
    render(<>{getClassIcon('Bard')}</>);
    render(<>{getClassIcon('Unknown')}</>);
    // Just verifying they render without error
  });
});
