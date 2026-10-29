/**
 * #866 item 3 (skill step only): the Rogue's class skill card on the
 * Proficiencies step carries its title and class sentence. NOT covered here:
 * the finalization panel's skill clause, which has no test yet. Harness
 * follows proficiencies-899.test.tsx.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import ProficienciesSelection from '../ProficienciesSelection';

import { backgrounds } from '@/data/backgroundOptions';
import { rogue } from '@/data/classes/rogue';
import { human } from '@/data/races/human';

const dispatch = vi.fn();
let character: Record<string, unknown>;

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character }, dispatch }),
}));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const criminal = backgrounds.find((b) => b.id === 'criminal')!;

beforeEach(() => {
  dispatch.mockClear();
  character = { name: 'Rogue', class: rogue, race: human, background: criminal };
});

describe('#866 Rogue class skill clause', () => {
  it('labels the four class skills with a title and the class sentence', () => {
    render(<ProficienciesSelection />);
    expect(screen.getByText('Choose Skills (0/4)')).toBeTruthy();
    expect(
      screen.getByText(/Your Rogue class allows you to choose 4 skills from the following:/),
    ).toBeTruthy();
  });

  it('counts the picks as the player selects them', () => {
    const { container } = render(<ProficienciesSelection />);
    for (const skill of ['Acrobatics', 'Athletics', 'Insight', 'Perception']) {
      fireEvent.click(container.querySelector(`[id="${skill}"]`)!);
    }
    expect(screen.getByText('Choose Skills (4/4)')).toBeTruthy();
  });
});
