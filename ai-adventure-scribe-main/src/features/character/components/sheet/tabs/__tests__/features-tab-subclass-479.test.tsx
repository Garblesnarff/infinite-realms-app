import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import FeaturesTab from '../FeaturesTab';

import type { Character } from '@/types/character';

import {
  getCharacterClassFeatures,
  type CharacterClassFeaturesResponse,
} from '@/services/class-features-api';

vi.mock('@/services/class-features-api', () => ({
  getCharacterClassFeatures: vi.fn(),
}));

const buildCharacter = (overrides: Partial<Character> = {}): Character =>
  ({
    id: 'char-1',
    name: 'Test Fighter',
    level: 3,
    race: { id: 'human', name: 'Human', traits: ['Darkvision'] },
    class: { id: 'fighter', name: 'Fighter' },
    ...overrides,
  }) as Character;

const subclassResponse: CharacterClassFeaturesResponse = {
  features: [
    {
      id: 'grant-1',
      characterId: 'char-1',
      featureId: 'feature-1',
      usesRemaining: null,
      isActive: true,
      acquiredAtLevel: 3,
      createdAt: '2026-01-01T00:00:00.000Z',
      feature: {
        id: 'feature-1',
        className: 'Fighter',
        subclassName: 'Champion',
        featureName: 'Improved Critical',
        levelAcquired: 3,
        description: 'Crit on a 19 or 20.',
        mechanicalEffects: null,
        usageType: null,
        usesPerRest: null,
        usesCount: null,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    },
  ],
  usesRemaining: {},
};

const renderTab = (character: Character): ReturnType<typeof render> => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FeaturesTab character={character} onUpdate={async () => true} />
    </QueryClientProvider>,
  );
};

describe('FeaturesTab subclass features (#479)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a subclass feature returned by the server', async () => {
    vi.mocked(getCharacterClassFeatures).mockResolvedValue(subclassResponse);

    renderTab(buildCharacter());

    expect(await screen.findByText('Improved Critical')).toBeInTheDocument();
    expect(vi.mocked(getCharacterClassFeatures)).toHaveBeenCalledWith('char-1');
  });

  it('still renders the other features when the subclass call fails', async () => {
    vi.mocked(getCharacterClassFeatures).mockRejectedValue(new Error('API 500'));

    renderTab(buildCharacter());

    expect((await screen.findAllByText('Darkvision')).length).toBeGreaterThan(0);
    expect(screen.queryByText('Improved Critical')).not.toBeInTheDocument();
  });
});
