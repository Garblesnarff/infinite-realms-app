/**
 * #621 B2b step 2: the combat controls offer only the class features the server answers. Second
 * Wind, Action Surge and Divine Sense have server intents (#975). Rage and every other feature have
 * none, so they are not offered here.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassFeaturesSection } from '../ClassFeaturesSection';

const feature = (name: string, type: 'active' | 'passive' = 'active') => ({
  name,
  type,
  maxUses: type === 'passive' ? undefined : 2,
  currentUses: type === 'passive' ? undefined : 2,
});

const fighter = (classFeatures: ReturnType<typeof feature>[]) =>
  ({
    id: 'p1',
    name: 'Fighter',
    classFeatures,
    resources: {},
  }) as never;

describe('ClassFeaturesSection offers only server-answered features (#621 B2b step 2)', () => {
  it('shows Second Wind, Action Surge and Divine Sense', () => {
    render(
      <ClassFeaturesSection
        currentParticipant={fighter([
          feature('second_wind'),
          feature('action_surge'),
          feature('divine_sense'),
        ])}
        onClassFeatureUse={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /second wind/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /action surge/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /divine sense/ })).toBeInTheDocument();
  });

  it('does not offer rage, or any other feature with no server intent', () => {
    render(
      <ClassFeaturesSection
        currentParticipant={fighter([feature('rage'), feature('second_wind')])}
        onClassFeatureUse={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: /rage/i })).toBeNull();
    expect(screen.getByRole('button', { name: /second wind/ })).toBeInTheDocument();
  });

  it('sends the participant and the feature name when a server feature is clicked', () => {
    const onClassFeatureUse = vi.fn();
    render(
      <ClassFeaturesSection
        currentParticipant={fighter([feature('action_surge')])}
        onClassFeatureUse={onClassFeatureUse}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /action surge/ }));

    expect(onClassFeatureUse).toHaveBeenCalledWith('p1', 'action_surge');
  });
});
