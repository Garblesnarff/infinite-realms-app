/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useInitialGreeting } from '../use-initial-greeting';

import { supabase } from '@/integrations/supabase/client';
import { AIService } from '@/services/ai-service';

// Mock dependencies
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

vi.mock('@/hooks/use-toast', () => ({
  useToast: vi.fn(() => ({
    toast: vi.fn(),
  })),
}));

// Mock global fetch
global.fetch = vi.fn();

describe('useInitialGreeting', () => {
  const sessionId = 'test-session-id';
  const characterId = 'test-character-id';
  const campaignId = 'test-campaign-id';
  const onGreetingGenerated = vi.fn().mockResolvedValue(undefined);
  const onMemoryCreated = vi.fn().mockResolvedValue(undefined);

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

    // Default mock implementation for Supabase
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
              level: 1
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
            error: null,
          }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };
    });

    (global.fetch as any).mockResolvedValue({
      ok: false, // Default to no recap
    });
  });

  it('should generate initial greeting for a new session', async () => {
    const greetingText = 'Welcome to the adventure! The air is fresh.';
    (AIService.generateOpeningMessage as any).mockResolvedValue(greetingText);

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalled(), { timeout: 2000 });

    expect(onGreetingGenerated).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: 'dm',
        text: greetingText,
      }),
    );

    // Verify memory creation
    // 4 memories: character, campaign, scene, atmosphere (triggered by "air" in greetingText)
    await waitFor(() => expect(onMemoryCreated).toHaveBeenCalledTimes(4), { timeout: 2000 });

    // Verify character memory
    expect(onMemoryCreated).toHaveBeenCalledWith(expect.objectContaining({
      type: 'character_moment',
      content: expect.stringContaining('Hero'),
    }));
  });

  it('should handle dialogue_history check error', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'dialogue_history') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: null, error: { message: 'DB Error' } }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: {}, error: null }),
      };
    });
    (AIService.generateOpeningMessage as any).mockResolvedValue('Hello');

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('should skip generation if messages already exist', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'dialogue_history') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ count: 5, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn(),
      };
    });

    renderHook(() => useInitialGreeting(defaultProps));

    // Wait a bit to ensure it doesn't trigger
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(onGreetingGenerated).not.toHaveBeenCalled();
    expect(AIService.generateOpeningMessage).not.toHaveBeenCalled();
  });

  it('should handle continuation session recap with Auth token', async () => {
    localStorage.setItem('workos_access_token', 'fake-token');
    const props = {
      ...defaultProps,
      sessionData: { turn_count: 0, session_number: 2 },
    };
    const recapText = 'Previously on...';
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ result: { data: { previouslyOn: recapText } } }),
    });
    (AIService.generateOpeningMessage as any).mockResolvedValue('Opening message');

    renderHook(() => useInitialGreeting(props));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalledTimes(2), { timeout: 2000 });

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining('chronicles.getPreviouslyOn'),
      expect.objectContaining({
        headers: { Authorization: 'Bearer fake-token' }
      })
    );

    expect(onGreetingGenerated).toHaveBeenNthCalledWith(1, expect.objectContaining({
      text: recapText,
      context: { previouslyOn: true }
    }));
  });

  it('should handle fetch recap failure gracefully', async () => {
    const props = {
      ...defaultProps,
      sessionData: { turn_count: 0, session_number: 2 },
    };
    (global.fetch as any).mockRejectedValue(new Error('Fetch failed'));
    (AIService.generateOpeningMessage as any).mockResolvedValue('Opening message');

    renderHook(() => useInitialGreeting(props));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onGreetingGenerated).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Opening message'
    }));
  });

  it('should use fallback greeting on AI failure', async () => {
    (AIService.generateOpeningMessage as any).mockRejectedValue(new Error('AI Error'));

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalled(), { timeout: 2000 });

    expect(onGreetingGenerated).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('You find yourself standing at the threshold')
    }));
  });

  it('should handle fallback greeting failure gracefully', async () => {
    (AIService.generateOpeningMessage as any).mockRejectedValue(new Error('AI Error'));
    onGreetingGenerated.mockRejectedValueOnce(new Error('onGreetingGenerated failed'));

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('should handle memory creation failure gracefully', async () => {
    (AIService.generateOpeningMessage as any).mockResolvedValue('Welcome');
    onMemoryCreated.mockRejectedValue(new Error('Memory failed'));

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('should extract atmosphere correctly', async () => {
    const greetingText = 'The sun shines brightly. The air smells like pine.';
    (AIService.generateOpeningMessage as any).mockResolvedValue(greetingText);

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() => {
      expect(onGreetingGenerated).toHaveBeenCalled();
    }, { timeout: 2000 });

    await waitFor(() => {
      const calls = onMemoryCreated.mock.calls;
      const atmosphereMemoryCall = calls.find(
        (call: any) => call[0].type === 'atmosphere'
      );
      if (!atmosphereMemoryCall) return false;
      // Note: the bug fix in use-initial-greeting.ts ensures single space joining
      expect(atmosphereMemoryCall[0].content).toBe('Initial atmosphere: The sun shines brightly. The air smells like pine.');
      return true;
    }, { timeout: 2000 });
  });

  it('should handle character data load error', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'characters') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Char Error' } }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: {}, error: null }),
      };
    });

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalled(), { timeout: 2000 });
    // Should use fallback due to catch block
    expect(onGreetingGenerated).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('You find yourself standing at the threshold')
    }));
  });

  it('should handle campaign data load error', async () => {
    (supabase.from as any).mockImplementation((table: string) => {
      if (table === 'campaigns') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Camp Error' } }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: {}, error: null }),
      };
    });

    renderHook(() => useInitialGreeting(defaultProps));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalled(), { timeout: 2000 });
    // Should use fallback
    expect(onGreetingGenerated).toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('You find yourself standing at the threshold')
    }));
  });

  it('should handle missing onMemoryCreated callback', async () => {
    (AIService.generateOpeningMessage as any).mockResolvedValue('Hello');
    const props = { ...defaultProps, onMemoryCreated: undefined };

    renderHook(() => useInitialGreeting(props));

    await waitFor(() => expect(onGreetingGenerated).toHaveBeenCalled(), { timeout: 2000 });
  });

  it('should not trigger if turn_count is not 0', async () => {
    const props = {
      ...defaultProps,
      sessionData: { turn_count: 1 },
    };

    renderHook(() => useInitialGreeting(props));

    await new Promise(resolve => setTimeout(resolve, 200));
    expect(onGreetingGenerated).not.toHaveBeenCalled();
  });

  it('should not trigger if messages are already present in props', async () => {
    const props = {
      ...defaultProps,
      messages: [{ id: '1', text: 'Hi', sender: 'dm' as const, timestamp: 'now' }],
    };

    renderHook(() => useInitialGreeting(props));

    await new Promise(resolve => setTimeout(resolve, 200));
    expect(onGreetingGenerated).not.toHaveBeenCalled();
  });
});
