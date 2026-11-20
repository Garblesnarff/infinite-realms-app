import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { FeatureSection } from '../FeatureSection';

import type { Character } from '@/types/character';
import type { ClassFeature } from '@/types/combat';

import { InCombatFlagContext } from '@/contexts/in-combat-flag';
import { SheetHitPointsContext } from '@/contexts/sheet-hit-points';

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

// #1679: Second Wind is refused at full HP and in a fight, so its button is disabled with the
// reason as its description, as Heal self is (#1658). Hurt out of combat it stays enabled.
describe('FeatureSection Second Wind refusals (#1679)', () => {
  it('disables Use Feature at full HP and says why', () => {
    render(
      <SheetHitPointsContext.Provider value={{ current: 12, maximum: 12 }}>
        <FeatureSection character={paladin} classFeatures={[secondWind]} onUseResource={vi.fn()} />
      </SheetHitPointsContext.Provider>,
    );

    const button = screen.getByRole('button', { name: /use feature/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription('You are already at full health.');
  });

  it('disables Use Feature in a fight and points to the combat actions', () => {
    render(
      <InCombatFlagContext.Provider value={true}>
        <FeatureSection character={paladin} classFeatures={[secondWind]} onUseResource={vi.fn()} />
      </InCombatFlagContext.Provider>,
    );

    const button = screen.getByRole('button', { name: /use feature/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription(
      'In combat, use Second Wind from the combat actions.',
    );
  });

  it('leaves Use Feature enabled when the hero is hurt out of combat', () => {
    const onUseResource = vi.fn();
    render(
      <SheetHitPointsContext.Provider value={{ current: 7, maximum: 12 }}>
        <FeatureSection
          character={paladin}
          classFeatures={[secondWind]}
          onUseResource={onUseResource}
        />
      </SheetHitPointsContext.Provider>,
    );

    const button = screen.getByRole('button', { name: /use feature/i });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAccessibleDescription();
  });
});
