/**
 * #1402: the Finalize summary names the chosen equipment, or says none was chosen.
 * Renders the real CharacterFinalization; only the character state is stubbed.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Character } from '@/types/character';

import CharacterFinalization from '@/components/character-creation/steps/CharacterFinalization';
import { backgrounds } from '@/data/backgroundOptions';
import { monk } from '@/data/classes/monk';

let mockCharacter: Partial<Character> = {};

vi.mock('@/services/character-description-generator', () => ({
  characterDescriptionGenerator: { generateDescription: vi.fn() },
}));

vi.mock('@/contexts/CharacterContext', () => ({
  useCharacter: () => ({
    state: { character: mockCharacter },
    dispatch: vi.fn(),
  }),
}));

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }) }));

vi.mock('@/services/openrouter-service', () => ({ openRouterService: { uploadImage: vi.fn() } }));

const outlander = backgrounds.find((b) => b.id === 'outlander');

function renderSummary(character: Partial<Character>): string {
  mockCharacter = { name: 'Hero', description: '', theme: 'fantasy', ...character };
  render(
    <MemoryRouter>
      <CharacterFinalization />
    </MemoryRouter>,
  );
  return screen.getByText('Equipment:').parentElement?.textContent ?? '';
}

describe('Finalize summary equipment line (#1402)', () => {
  beforeEach(() => {
    mockCharacter = {};
  });

  it('says No equipment chosen when no option was picked', () => {
    expect(renderSummary({ class: monk, background: outlander ?? null, equipment: [] })).toBe(
      'Equipment: No equipment chosen',
    );
  });

  it('names the package, its item count (background items excluded) and the gold', () => {
    const backgroundItems = outlander?.equipment ?? [];
    const line = renderSummary({
      class: monk,
      background: outlander ?? null,
      selectedEquipmentOptionIndex: 0,
      equipment: [...backgroundItems, 'Dagger', 'Staff'],
      currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
    });
    // Outlander's bare '10 gp' coin string is purse money, not an item (#971).
    // Names (background + package) replace the old package/count label (#1402 reopen).
    expect(line).toBe(
      "Equipment: Monk Equipment Package: Staff, Hunting trap, Traveler's clothes, Belt pouch, Dagger, Staff, 10 gp starting gold",
    );
  });

  it('names starting gold when the gold option was chosen', () => {
    const line = renderSummary({
      class: monk,
      background: null,
      selectedEquipmentOptionIndex: 1,
      equipment: [],
      currency: { cp: 0, sp: 0, ep: 0, gp: 14, pp: 0 },
    });
    expect(line).toBe('Equipment: Starting Gold: 14 gp, no equipment package');
  });
});
