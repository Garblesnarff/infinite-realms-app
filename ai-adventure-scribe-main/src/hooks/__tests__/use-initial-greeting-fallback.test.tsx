import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useInitialGreeting } from '../use-initial-greeting';

const { listSessionMessages, getCharacter, getCampaign, generateOpeningMessage } = vi.hoisted(
  () => ({
    listSessionMessages: vi.fn(),
    getCharacter: vi.fn(),
    getCampaign: vi.fn(),
    generateOpeningMessage: vi.fn(),
  }),
);

vi.mock('@/services/user-data-api', () => ({
  userDataApi: { listSessionMessages, getCharacter, getCampaign },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { generateOpeningMessage },
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('useInitialGreeting fallback recovery', () => {
  it('regenerates when the session contains only the stored fallback', async () => {
    listSessionMessages.mockResolvedValue({
      total: 1,
      messages: [{ speaker_type: 'dm', context: { isFallback: true } }],
    });
    getCharacter.mockResolvedValue({ id: 'character-id', name: 'Hero', class: 'Cleric', level: 1 });
    getCampaign.mockResolvedValue({ id: 'campaign-id', name: 'The Eternal Feast' });
    generateOpeningMessage.mockResolvedValue('The real opening scene.');
    const onGreetingGenerated = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialGreeting({
        sessionId: 'session-id',
        sessionData: { turn_count: 0, starter_campaign_id: 'the-eternal-feast' },
        characterId: 'character-id',
        campaignId: 'campaign-id',
        messages: [
          {
            sender: 'dm',
            text: 'fallback',
            context: { isFallback: true },
          },
        ],
        messagesLoading: false,
        onGreetingGenerated,
      }),
    );

    await waitFor(() =>
      expect(onGreetingGenerated).toHaveBeenCalledWith(
        expect.objectContaining({ text: 'The real opening scene.' }),
      ),
    );
    expect(generateOpeningMessage).toHaveBeenCalledTimes(1);
  });
});
