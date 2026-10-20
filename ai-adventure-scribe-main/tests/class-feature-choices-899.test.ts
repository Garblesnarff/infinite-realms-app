/**
 * #899: reading the class-feature choices the creation wizard stores.
 *
 * Fixture fidelity: the class_features objects below are built exactly the
 * way the real producer — ClassFeatureSelection.updateClassFeatures — builds
 * them (Record<featureId, { name, description, choice }>), with the real
 * Sorcerous Origin option strings from src/data/classes/sorcerer.ts.
 */
import { describe, expect, it } from 'vitest';

import { getClassFeatureChoice, isDraconicBloodline } from '../shared/class-feature-choices';

const draconicFeatures = {
  'sorcerous-origin': {
    name: 'Sorcerous Origin',
    description:
      'Choose a sorcerous origin, which describes the source of your innate magical power.',
    choice:
      'Draconic Bloodline: Your innate magic comes from draconic magic that was mingled with your blood',
  },
  spellcasting: {
    name: 'Spellcasting',
    description:
      'An event in your past, or in the life of a parent or ancestor, left an indelible mark on you, infusing you with arcane magic.',
  },
};

describe('getClassFeatureChoice (#899)', () => {
  it('returns the stored option string for a feature', () => {
    expect(getClassFeatureChoice(draconicFeatures, 'sorcerous-origin')).toBe(
      draconicFeatures['sorcerous-origin'].choice,
    );
  });

  it('returns null for a feature without a choice, a missing feature, and non-objects', () => {
    expect(getClassFeatureChoice(draconicFeatures, 'spellcasting')).toBeNull();
    expect(getClassFeatureChoice(draconicFeatures, 'metamagic')).toBeNull();
    expect(getClassFeatureChoice(null, 'sorcerous-origin')).toBeNull();
    expect(getClassFeatureChoice(undefined, 'sorcerous-origin')).toBeNull();
    expect(getClassFeatureChoice('Draconic Bloodline', 'sorcerous-origin')).toBeNull();
    expect(getClassFeatureChoice({}, 'sorcerous-origin')).toBeNull();
  });
});

describe('isDraconicBloodline (#899)', () => {
  it('is true only for the Draconic Bloodline origin choice', () => {
    expect(isDraconicBloodline(draconicFeatures)).toBe(true);
    expect(
      isDraconicBloodline({
        'sorcerous-origin': {
          name: 'Sorcerous Origin',
          description: draconicFeatures['sorcerous-origin'].description,
          choice: 'Wild Magic: Your innate magic comes from the wild forces of chaos',
        },
      }),
    ).toBe(false);
    expect(isDraconicBloodline({})).toBe(false);
    expect(isDraconicBloodline(null)).toBe(false);
  });
});
