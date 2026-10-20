/**
 * #899: the Proficiencies & Languages step is the producer that writes a new
 * character's languages and skill proficiencies. Class-granted languages
 * (Druidic) and race-granted skill proficiencies (a half-orc's Menacing)
 * must land in that payload without consuming any of the player's choices.
 * Harness follows proficiencies-expertise.test.tsx (#898).
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import ProficienciesSelection from '../ProficienciesSelection';

import { backgrounds } from '@/data/backgroundOptions';
import { druid } from '@/data/classes/druid';
import { fighter } from '@/data/classes/fighter';
import { halfOrc } from '@/data/races/half-orc';
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

function lastUpdatePayload(): Record<string, unknown> {
  const calls = dispatch.mock.calls
    .map((c: unknown[]) => c[0] as { type?: string; payload?: Record<string, unknown> })
    .filter((a) => a?.type === 'UPDATE_CHARACTER');
  return calls[calls.length - 1]?.payload ?? {};
}

beforeEach(() => {
  dispatch.mockClear();
});

describe('#899 proficiencies step', () => {
  it('grants a druid the Druidic language (D20-004)', () => {
    character = { name: 'Druid', class: druid, race: human, background: criminal };
    const { container } = render(<ProficienciesSelection />);
    fireEvent.click(container.querySelector('[id="Animal Handling"]')!);
    fireEvent.click(container.querySelector('[id="Nature"]')!);

    const payload = lastUpdatePayload();
    expect(payload.languages).toEqual(expect.arrayContaining(['Common', 'Druidic']));
    expect(payload.skillProficiencies).toEqual(
      expect.arrayContaining(['Deception', 'Stealth', 'Animal Handling', 'Nature']),
    );
  });

  it("grants a half-orc the Menacing Intimidation proficiency (D20-001)", () => {
    character = { name: 'Half-Orc', class: fighter, race: halfOrc, background: criminal };
    const { container } = render(<ProficienciesSelection />);
    fireEvent.click(container.querySelector('[id="Athletics"]')!);
    fireEvent.click(container.querySelector('[id="Perception"]')!);

    const payload = lastUpdatePayload();
    // Intimidation arrives from the race (Menacing), on top of the two
    // background skills and the fighter's two chosen skills.
    expect(payload.skillProficiencies).toEqual(
      expect.arrayContaining(['Deception', 'Stealth', 'Athletics', 'Perception', 'Intimidation']),
    );
    expect(payload.languages).toEqual(expect.arrayContaining(['Common', 'Orc']));
  });
});
