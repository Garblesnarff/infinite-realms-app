import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { StarterTemplateCard } from '../StarterTemplateCard';

import type { StarterTemplate } from '@/features/campaign/hooks/use-character-selection';

const getModifier = (score?: number): string => {
  if (!score) return '+0';
  const mod = Math.floor((score - 10) / 2);
  return mod >= 0 ? `+${mod}` : `${mod}`;
};

const baseTemplate: StarterTemplate = {
  id: 'tpl-1',
  starter_campaign_id: 'abyssal-descent',
  template_key: 'the-scholar',
  name: 'The Scholar',
  tagline: null,
  race: 'Elf',
  subrace: 'Wood Elf',
  class: 'Wizard',
  background: 'Sage',
  level: 1,
  ability_scores: {
    strength: 8,
    dexterity: 14,
    constitution: 12,
    intelligence: 16,
    wisdom: 12,
    charisma: 10,
  },
  personality: {},
  skills: [],
  languages: [],
  equipment: [],
  adapted_backstory: null,
  campaign_hook: null,
  portrait_url: null,
  card_image_url: null,
  portrait_prompt: null,
  display_order: 1,
};

const renderCard = (template: StarterTemplate): void => {
  render(
    <StarterTemplateCard
      template={template}
      isCreating={false}
      onSelect={vi.fn()}
      getModifier={getModifier}
    />,
  );
};

describe('StarterTemplateCard', () => {
  it('shows resolved scores (base + racial bonuses), the same math the sheet uses (#153)', () => {
    // Elf: DEX +2; Wood Elf: WIS +1. Sheet's useEffectiveAbilityScores does
    // base + getTotalRacialBonus with no cap; the preview must match it.
    renderCard(baseTemplate);

    expect(screen.getByLabelText('Dexterity modifier: +3')).toBeInTheDocument(); // 14 + 2
    expect(screen.getByLabelText('Wisdom modifier: +1')).toBeInTheDocument(); // 12 + 1
    expect(screen.getByLabelText('Intelligence modifier: +3')).toBeInTheDocument(); // 16 + 0
    expect(screen.getByLabelText('Strength modifier: -1')).toBeInTheDocument(); // 8 + 0
    // The raw base score must NOT be shown (DEX 14 -> +2 raw, +3 resolved).
    expect(screen.queryByLabelText('Dexterity modifier: +2')).not.toBeInTheDocument();
  });

  it('applies only race bonuses when the template has no subrace', () => {
    renderCard({ ...baseTemplate, subrace: null });

    expect(screen.getByLabelText('Dexterity modifier: +3')).toBeInTheDocument(); // 14 + 2
    expect(screen.getByLabelText('Wisdom modifier: +1')).toBeInTheDocument(); // 12 + 0, unchanged
  });

  it('falls back to base scores when the race is unknown', () => {
    renderCard({ ...baseTemplate, race: 'Mystery Folk', subrace: null });

    expect(screen.getByLabelText('Dexterity modifier: +2')).toBeInTheDocument(); // 14 + 0
    expect(screen.getByLabelText('Intelligence modifier: +3')).toBeInTheDocument();
  });

  it('matches the sheet for the real Scholar premade from run D5 (#153)', () => {
    // Values copied from the abyssal-descent seed: Human, no subrace, so no
    // racial bonuses — the preview must show the base scores, exactly what the
    // sheet resolves (INT 18 -> +4, WIS 14 -> +2).
    renderCard({
      ...baseTemplate,
      name: 'The Scholar',
      template_key: 'the-scholar',
      race: 'Human',
      subrace: null,
      class: 'Wizard',
      ability_scores: {
        strength: 8,
        dexterity: 12,
        constitution: 12,
        intelligence: 18,
        wisdom: 14,
        charisma: 10,
      },
    });

    expect(screen.getByLabelText('Intelligence modifier: +4')).toBeInTheDocument();
    expect(screen.getByLabelText('Wisdom modifier: +2')).toBeInTheDocument();
    expect(screen.getByLabelText('Strength modifier: -1')).toBeInTheDocument();
  });
});
