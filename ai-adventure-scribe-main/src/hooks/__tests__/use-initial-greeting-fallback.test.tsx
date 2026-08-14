import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useInitialGreeting } from '../use-initial-greeting';

const {
  listSessionMessages,
  listMemories,
  updateMemoryContent,
  getCharacter,
  getCampaign,
  generateOpeningMessage,
} = vi.hoisted(() => ({
  listSessionMessages: vi.fn(),
  listMemories: vi.fn(),
  updateMemoryContent: vi.fn(),
  getCharacter: vi.fn(),
  getCampaign: vi.fn(),
  generateOpeningMessage: vi.fn(),
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listSessionMessages,
    listMemories,
    updateMemoryContent,
    getCharacter,
    getCampaign,
  },
}));
vi.mock('@/services/ai-service', () => ({
  AIService: { generateOpeningMessage },
}));
vi.mock('@/infrastructure/api', () => ({
  llmApiClient: {
    generateText: vi
      .fn()
      .mockResolvedValue(
        'A. **Look around**, survey your surroundings.\nB. **Press on**, continue toward your goal.\nC. **Call out**, announce your presence.',
      ),
  },
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
    generateOpeningMessage.mockResolvedValue(
      'The real opening scene unfolds beneath a copper sky as the first watch bell echoes across the valley.',
    );
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
        expect.objectContaining({
          text: expect.stringContaining(
            'The real opening scene unfolds beneath a copper sky as the first watch bell echoes across the valley.',
          ),
        }),
      ),
    );
    expect(generateOpeningMessage).toHaveBeenCalledTimes(1);
  });

  it('regenerates a short stored greeting and replaces its Opening Scene memory', async () => {
    listSessionMessages.mockResolvedValue({
      total: 1,
      messages: [{ speaker_type: 'dm', message: '{' }],
    });
    listMemories.mockResolvedValue([{ id: 'opening-memory', content: 'Opening Scene: {' }]);
    updateMemoryContent.mockResolvedValue(undefined);
    getCharacter.mockResolvedValue({ id: 'character-id', name: 'Hero', class: 'Bard', level: 1 });
    getCampaign.mockResolvedValue({ id: 'campaign-id', name: 'The Eternal Feast' });
    generateOpeningMessage.mockResolvedValue(
      'The market square awakens beneath amber light as rain beads on the old cobblestones.',
    );
    const onGreetingGenerated = vi.fn().mockResolvedValue(undefined);
    const onMemoryCreated = vi.fn().mockResolvedValue(undefined);

    renderHook(() =>
      useInitialGreeting({
        sessionId: 'session-id',
        sessionData: { turn_count: 0 },
        characterId: 'character-id',
        campaignId: 'campaign-id',
        messages: [{ sender: 'dm', text: '{', context: {} }],
        messagesLoading: false,
        onGreetingGenerated,
        onMemoryCreated,
      }),
    );

    await waitFor(() => expect(updateMemoryContent).toHaveBeenCalledTimes(1));
    expect(updateMemoryContent).toHaveBeenCalledWith(
      'opening-memory',
      'Opening Scene: The market square awakens beneath amber light as rain beads on the old cobblestones.',
    );
    expect(onMemoryCreated).not.toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Opening Scene:') }),
    );
  });
});
