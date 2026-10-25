/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #1095 (Hark S2-002): at a Session 2 start, no Story clock element
 * showed at all. The greeting message is built directly in
 * use-initial-greeting — it never passes the use-ai-response latch, so
 * the #1062 envelope line cannot reach it even on turns the server
 * attached one.
 *
 * The fix mirrors the latch: the greeting carries the opening
 * response's story_trackers when present, else falls back to GET the
 * session's trackers, so the session's first turn shows the clock too.
 *
 * Everything below mirrors the `use-initial-greeting.test.tsx`
 * harness; only the fetch stub routes the trackers URL.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useInitialGreeting } from '../use-initial-greeting';

import { supabase } from '@/integrations/supabase/client';
import { AIService } from '@/services/ai-service';
import { userDataApi } from '@/services/user-data-api';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/services/ai-service', () => ({
  AIService: {
    generateOpeningMessage: vi.fn(),
  },
}));

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listSessionMessages: vi.fn(),
    getCharacter: vi.fn(),
    getCampaign: vi.fn(),
  },
}));

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

// ensure-action-options repairs option-less openings via llmApiClient; keep it
// deterministic and offline in unit tests.
vi.mock('@/infrastructure/api', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    llmApiClient: {
      generateText: vi
        .fn()
        .mockResolvedValue(
          'A. **Look around**, survey your surroundings.\nB. **Press on**, continue toward your goal.\nC. **Call out**, announce your presence.',
        ),
    },
  };
});

// Mock global fetch
global.fetch = vi.fn() as unknown as typeof fetch;

describe('useInitialGreeting: story-trackers GET fallback (#1095)', () => {
  const sessionId = 'test-session-id';
  const characterId = 'test-character-id';
  const campaignId = 'test-campaign-id';
  const onGreetingGenerated = vi.fn().mockResolvedValue(undefined);
  const onMemoryCreated = vi.fn().mockResolvedValue(undefined);
  const fetchedTrackers = [{ name: 'Wall Clock', value: 2, limit: 6 }];

  const defaultProps = {
    sessionId,
    sessionData: { turn_count: 0 },
    characterId,
    campaignId,
    messages: [],
    messagesLoading: false,
    onGreetingGenerated,
    onMemoryCreated,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'dialogue_history') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: 0, error: null }),
        };
      }
      if (table === 'characters') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              id: characterId,
              name: 'Hero',
              race: 'Human',
              class: 'Fighter',
              background: 'Soldier',
              level: 1,
            },
            error: null,
          }),
        };
      }
      if (table === 'campaigns') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: campaignId, name: 'Epic Quest', description: 'Save the world' },
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };
    });

    // The recap fetch gets no recap; the trackers URL gets the session's trackers.
    (global.fetch as any).mockImplementation(async (url: string) => {
      if (String(url).includes('/trackers')) {
        return { ok: true, json: async () => ({ trackers: fetchedTrackers }) };
      }
      return { ok: false };
    });
    (userDataApi.listSessionMessages as any).mockResolvedValue({ total: 0, messages: [] });
    (userDataApi.getCharacter as any).mockResolvedValue({
      id: characterId,
      name: 'Hero',
      race: 'Human',
      class: 'Fighter',
      background: 'Soldier',
      level: 1,
    });
    (userDataApi.getCampaign as any).mockResolvedValue({
      id: campaignId,
      name: 'Epic Quest',
      description: 'Save the world',
    });
  });

  it('a greeting with no envelope field carries the GET fallback trackers', async () => {
    const greetingText =
      'Welcome to the adventure! The air is fresh, and distant bells echo beyond the forest road.';
    (AIService.generateOpeningMessage as any).mockResolvedValue({ text: greetingText });

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() =>
      expect(onGreetingGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: 'dm',
          context: expect.objectContaining({ storyTrackers: fetchedTrackers }),
        }),
      ),
    );
  });

  it('an envelope field on the opening response wins over the GET fallback', async () => {
    const greetingText =
      'Welcome to the adventure! The air is fresh, and distant bells echo beyond the forest road.';
    const envelopeTrackers = [{ name: 'Wall Clock', value: 4, limit: 6 }];
    (AIService.generateOpeningMessage as any).mockResolvedValue({
      text: greetingText,
      story_trackers: envelopeTrackers,
    });

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() =>
      expect(onGreetingGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: 'dm',
          context: expect.objectContaining({ storyTrackers: envelopeTrackers }),
        }),
      ),
    );
    expect(global.fetch as any).not.toHaveBeenCalledWith(
      expect.stringContaining('/trackers'),
      expect.anything(),
    );
  });

  it('an empty envelope array refetches (empty is absent, not a value)', async () => {
    const greetingText =
      'Welcome to the adventure! The air is fresh, and distant bells echo beyond the forest road.';
    (AIService.generateOpeningMessage as any).mockResolvedValue({
      text: greetingText,
      story_trackers: [],
    });

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() =>
      expect(onGreetingGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          sender: 'dm',
          context: expect.objectContaining({ storyTrackers: fetchedTrackers }),
        }),
      ),
    );
  });

  it('a null sessionId generates nothing and never fetches trackers', async () => {
    // The hook gates generation on a truthy sessionId, so the null
    // branch of the fallback can never run — but it must also never
    // fire a trackers GET for a session that does not exist. The pin
    // is the absence of both: no greeting, no fetch.
    (AIService.generateOpeningMessage as any).mockResolvedValue({
      text: 'Welcome to the adventure!',
    });

    renderHook(() => useInitialGreeting({ ...defaultProps, sessionId: null }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onGreetingGenerated).not.toHaveBeenCalled();
    expect(AIService.generateOpeningMessage).not.toHaveBeenCalled();
    expect(global.fetch as any).not.toHaveBeenCalledWith(
      expect.stringContaining('/trackers'),
      expect.anything(),
    );
  });
});
