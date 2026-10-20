/**
 * #899 Life Domain cleric (D20-003): the sheet's Proficiencies card must
 * show the heavy armor proficiency the Life Domain grants (Bonus
 * Proficiency), on top of the base cleric list.
 *
 * Fixture fidelity: classFeatures use the real ClassFeatureSelection
 * producer shape with the real Divine Domain option strings from
 * src/data/classes/cleric.ts; the class is the real cleric data.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import { FeaturesProficienciesCard } from '../FeaturesProficienciesCard';

import type { Character } from '@/types/character';

import { cleric } from '@/data/classes/cleric';

const clericWithDomain = (choice: string): Character =>
  ({
    name: 'Cleric',
    class: cleric,
    level: 1,
    languages: ['Common'],
    toolProficiencies: [],
    classFeatures: {
      'divine-domain': {
        name: 'Divine Domain',
        description:
          'Choose one domain related to your deity. Your choice grants you domain spells and other features when you choose it at 1st level.',
        choice,
      },
      spellcasting: {
        name: 'Spellcasting',
        description: 'As a conduit for divine power, you can cast cleric spells.',
      },
    },
  }) as unknown as Character;

describe('#899 FeaturesProficienciesCard — Life Domain heavy armor', () => {
  it('shows Heavy armor for a Life Domain cleric', () => {
    render(
      <FeaturesProficienciesCard
        character={clericWithDomain('Life Domain: Focuses on healing and protection')}
      />,
    );
    expect(screen.getByText('Heavy armor')).toBeDefined();
    expect(screen.getByText('Light armor')).toBeDefined();
    expect(screen.getByText('Medium armor')).toBeDefined();
  });

  it('does not show Heavy armor for another domain', () => {
    render(
      <FeaturesProficienciesCard
        character={clericWithDomain('Light Domain: Harnesses the power of flame and radiance')}
      />,
    );
    expect(screen.queryByText('Heavy armor')).toBeNull();
  });
});
