import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import CharacterFinalization from '@/components/character-creation/steps/CharacterFinalization';
import * as AnalyticsModule from '@/services/analytics';

vi.mock('@/services/character-description-generator', () => ({
  characterDescriptionGenerator: {
    generateDescription: vi.fn(async () => ({
      description: 'new desc',
      appearance: 'appearance',
      personality_traits: 'traits',
      backstory_elements: 'backstory',
    })),
  },
}));

vi.mock('@/contexts/CharacterContext', async () => {
  const dispatch = vi.fn();
  return {
    useCharacter: () => ({
      state: { character: { name: 'Hero', description: 'existing', theme: 'fantasy' } },
      dispatch,
    }),
  };
});

// use-character-finalization.ts (src/components/character-creation/steps/character-finalization/
// use-character-finalization.ts) now also calls useCampaign() to read the campaign's default
// art style - CharacterFinalization previously didn't need a CampaignProvider ancestor, so
// this test never wrapped it in one. Without a mock/provider, useCampaign() throws
// "must be used within a CampaignProvider" before the component can render at all.
vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({
    state: { campaign: null },
  }),
}));

// Toast can be a no-op
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: () => {} }) }));

// Silence image generator network usage in this test file
vi.mock('@/services/openrouter-service', () => ({ openRouterService: { uploadImage: vi.fn() } }));

describe('AI regenerate analytics', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('dispatches analytics and triggers description generator on Regenerate click', async () => {
    const spy = vi
      .spyOn(AnalyticsModule.analytics, 'aiRegenerateClicked')
      .mockImplementation(() => {});
    const { characterDescriptionGenerator } =
      await import('@/services/character-description-generator');

    render(
      <MemoryRouter initialEntries={['/app/characters/create?campaign=cmp-123']}>
        <CharacterFinalization />
      </MemoryRouter>,
    );

    const btn = await screen.findByRole('button', { name: /Regenerate with AI/i });
    fireEvent.click(btn);

    // The click handler dispatches analytics and calls the (async) description
    // generator without fireEvent.click awaiting it, so asserting synchronously right
    // after the click can race the handler and fail before it runs - wait instead (same
    // race fixed in wizard-completion-analytics.test.tsx).
    await waitFor(() => {
      expect(spy).toHaveBeenCalled();
      expect(characterDescriptionGenerator.generateDescription).toHaveBeenCalled();
    });
  });
});
