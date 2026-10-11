/**
 * #204: the Enhancements tab must show an empty state when the character has
 * no enhancements, not a blank tab.
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import EnhancementDetails from '../EnhancementDetails';

import type { Character } from '@/types/character';

const baseCharacter = (overrides: Partial<Character> = {}): Character =>
  ({
    id: 'char-1',
    name: 'Test Hero',
    ...overrides,
  }) as Character;

describe('EnhancementDetails (#204)', () => {
  it('shows an empty state when there are no enhancements', () => {
    render(<EnhancementDetails character={baseCharacter()} onUpdate={vi.fn()} />);

    expect(screen.getByText('No enhancements selected')).toBeInTheDocument();
  });

  it('lists stored quirk picks', () => {
    render(
      <EnhancementDetails
        character={baseCharacter({
          enhancementSelections: [
            { optionId: 'quirk-1', value: 'Scarred knuckles' },
            { optionId: 'quirk-2', value: 'Whistles when nervous' },
          ],
        })}
        onUpdate={vi.fn()}
      />,
    );

    expect(screen.getByText('Scarred knuckles')).toBeInTheDocument();
    expect(screen.getByText('Whistles when nervous')).toBeInTheDocument();
    expect(screen.queryByText('No enhancements selected')).not.toBeInTheDocument();
  });
});
