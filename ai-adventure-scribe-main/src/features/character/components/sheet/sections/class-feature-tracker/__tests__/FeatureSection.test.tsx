import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FeatureSection } from '../FeatureSection';

import type { Character } from '@/types/character';
import type { ClassFeature } from '@/types/combat';

const paladin = { class: { name: 'Paladin' } } as unknown as Character;

const layOnHands = {
  id: 'lay-on-hands',
  name: 'lay_on_hands',
  displayName: 'Lay on Hands',
  description: 'A pool of healing power.',
  level: 1,
  currentUses: 12,
  maxUses: 15,
} as unknown as ClassFeature;

const secondWind = {
  id: 'second-wind',
  name: 'second_wind',
  displayName: 'Second Wind',
  description: 'Regain hit points as a bonus action.',
  level: 1,
  currentUses: 1,
  maxUses: 1,
} as unknown as ClassFeature;

/** #1618: Lay on Hands spends through its own control; the generic Use Feature button must not offer it. */
describe('FeatureSection Lay on Hands row (#1618)', () => {
  it('shows no generic Use Feature button on the Lay on Hands row', () => {
    const onUseResource = vi.fn();
    render(
      <FeatureSection
        character={paladin}
        classFeatures={[layOnHands]}
        onUseResource={onUseResource}
      />,
    );

    const row = screen.getByText('Lay on Hands').closest('div.border-l-4') as HTMLElement;
    expect(within(row).queryByRole('button', { name: /use feature/i })).toBeNull();
  });

  it('keeps the Use Feature button on other features that have uses left', () => {
    const onUseResource = vi.fn();
    render(
      <FeatureSection
        character={paladin}
        classFeatures={[layOnHands, secondWind]}
        onUseResource={onUseResource}
      />,
    );

    const row = screen.getByText('Second Wind').closest('div.border-l-4') as HTMLElement;
    expect(within(row).getByRole('button', { name: /use feature/i })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /use feature/i })).toHaveLength(1);
  });
});
