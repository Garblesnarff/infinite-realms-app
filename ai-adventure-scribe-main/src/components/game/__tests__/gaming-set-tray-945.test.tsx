import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import fixture from '../../../../shared/test-fixtures/background-gaming-cards.json';
import { DiceRollRequest } from '../DiceRollRequest';

import type { Character } from '@/types/character';

import { transformCharacterData } from '@/utils/character/data-transformers';

let character: Character;
vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({ state: { character } }),
  useOptionalCharacter: () => ({ state: { character } }),
}));
vi.mock('@/features/game-session/components', () => ({ DiceRollEmbed: () => null }));
vi.mock('@/features/game-session/hooks/use-inspiration-spend', () => ({
  useInspirationSpend: () => ({ armed: false, disarm: vi.fn(), spendInspiration: vi.fn() }),
}));
vi.mock('@/features/game-session/contexts/inspiration-armed-context', () => ({
  useInspirationArmed: () => ({ armed: false }),
}));

function savedCharacter(tools: string, inventory: Array<{ itemId: string; quantity: number }>) {
  return {
    ...transformCharacterData(
      { ...fixture, tool_proficiencies: tools, id: 'saved' } as unknown as Parameters<
        typeof transformCharacterData
      >[0],
      null,
      [],
    ),
    level: 1,
    inventory,
    abilityScores: { intelligence: { score: 10, modifier: 0 } },
  } as Character;
}
function tray(kind: 'cards' | 'dice') {
  return (
    <DiceRollRequest
      request={{ type: 'check', formula: '1d20', purpose: `Gaming Set (${kind}) check` }}
      onResult={() => {}}
    />
  );
}
afterEach(cleanup);

describe('background gaming proficiency in the roll tray (#893, #945)', () => {
  it.each([
    [
      'both sets owned',
      [
        { itemId: 'deck-of-cards', quantity: 1 },
        { itemId: 'dice-set', quantity: 1 },
      ],
    ],
    ['sets removed', []],
  ])('shows only the saved cards choice when %s', (_label, inventory) => {
    character = savedCharacter(fixture.tool_proficiencies, inventory);
    const view = render(tray('cards'));
    expect(screen.getByText('Proficient')).toBeInTheDocument();
    view.rerender(tray('dice'));
    expect(screen.queryByText('Proficient')).not.toBeInTheDocument();
  });
  it('infers only dice for a legacy generic choice when only dice are owned', () => {
    character = savedCharacter('One type of gaming set', [{ itemId: 'dice-set', quantity: 1 }]);
    const view = render(tray('dice'));
    expect(screen.getByText('Proficient')).toBeInTheDocument();
    view.rerender(tray('cards'));
    expect(screen.queryByText('Proficient')).not.toBeInTheDocument();
  });
});
