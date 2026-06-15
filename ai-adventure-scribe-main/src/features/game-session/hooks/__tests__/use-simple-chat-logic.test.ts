/* eslint-disable @typescript-eslint/no-explicit-any */
import { renderHook, act, waitFor } from '@testing-library/react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { useSimpleChatLogic } from '../use-simple-chat-logic';

import { useSimpleGameSession } from '@/hooks/use-simple-game-session';
import { AIService } from '@/services/ai-service';
import { handleAsyncError } from '@/utils/error-handler';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  useNavigate: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/hooks/use-simple-game-session', () => ({
  useSimpleGameSession: vi.fn(),
}));

vi.mock('@/services/ai-service', () => ({
  AIService: {
    generateOpeningMessage: vi.fn(),
    getConversationHistory: vi.fn(),
    saveChatMessage: vi.fn(),
    chatWithDM: vi.fn(),
  },
}));

vi.mock('@/utils/error-handler', () => ({
  handleAsyncError: vi.fn((_err, options) => {
    if (options?.onError) options.onError();
  }),
}));

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('useSimpleChatLogic', () => {
  const campaignId = 'campaign-123';
  const characterId = 'char-456';
  const mockNavigate = vi.fn();
  const mockEndSession = vi.fn();

  const mockSession = {
    id: 'session-789',
    campaign_id: campaignId,
    character_id: characterId,
    status: 'active',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (useNavigate as any).mockReturnValue(mockNavigate);
    (useSimpleGameSession as any).mockReturnValue({
      session: mockSession,
      loading: false,
      endSession: mockEndSession,
    });
    (AIService.getConversationHistory as any).mockResolvedValue([]);

    // Mock scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should initialize and load history', async () => {
    const history = [
      { id: '1', role: 'assistant', content: 'Hello', timestamp: new Date() },
    ];
    (AIService.getConversationHistory as any).mockResolvedValue(history);

    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(result.current.messages).toEqual(history);
    });

    expect(AIService.getConversationHistory).toHaveBeenCalledWith(mockSession.id);
  });

  it('should generate opening message if history is empty', async () => {
    (AIService.getConversationHistory as any).mockResolvedValue([]);
    (AIService.generateOpeningMessage as any).mockResolvedValue('Welcome to the adventure!');

    renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(AIService.generateOpeningMessage).toHaveBeenCalled();
    });

    expect(AIService.saveChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'assistant',
      content: 'Welcome to the adventure!',
    }));
  });

  it('should handle error when generating opening message', async () => {
    (AIService.getConversationHistory as any).mockResolvedValue([]);
    (AIService.generateOpeningMessage as any).mockRejectedValue(new Error('AI Error'));

    renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(handleAsyncError).toHaveBeenCalled();
    });
  });

  it('should send a message successfully', async () => {
    (AIService.getConversationHistory as any).mockResolvedValue([{ id: '1', role: 'assistant', content: 'Hi', timestamp: new Date() }]);
    (AIService.chatWithDM as any).mockResolvedValue('I am the DM.');

    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    act(() => {
      result.current.setCurrentMessage('Hello DM');
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(AIService.saveChatMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'user',
      content: 'Hello DM',
    }));

    expect(AIService.chatWithDM).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Hello DM',
    }));

    expect(result.current.messages[result.current.messages.length - 1].content).toBe('I am the DM.');
  });

  it('should handle streaming AI responses', async () => {
    (AIService.getConversationHistory as any).mockResolvedValue([{ id: '1', role: 'assistant', content: 'Hi', timestamp: new Date() }]);

    (AIService.chatWithDM as any).mockImplementation(async (params: any) => {
      params.onStream('Hello');
      params.onStream(' world');
      return 'Hello world';
    });

    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    act(() => {
      result.current.setCurrentMessage('Hello');
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(AIService.chatWithDM).toHaveBeenCalled();
    expect(result.current.messages[result.current.messages.length - 1].content).toBe('Hello world');
  });

  it('should handle rate limit errors', async () => {
    (AIService.getConversationHistory as any).mockResolvedValue([{ id: '1', role: 'assistant', content: 'Hi', timestamp: new Date() }]);
    (AIService.chatWithDM as any).mockRejectedValue(new Error('Rate limit exceeded'));

    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    act(() => {
      result.current.setCurrentMessage('Test message');
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('Rate limit exceeded'),
      expect.any(Object)
    );
  });

  it('should handle all AI services unavailable errors', async () => {
    (AIService.getConversationHistory as any).mockResolvedValue([{ id: '1', role: 'assistant', content: 'Hi', timestamp: new Date() }]);
    (AIService.chatWithDM as any).mockRejectedValue(new Error('all AI services unavailable'));

    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    act(() => {
      result.current.setCurrentMessage('Test message');
    });

    await act(async () => {
      await result.current.sendMessage();
    });

    expect(toast.error).toHaveBeenCalledWith(
      expect.stringContaining('AI services are currently unavailable'),
      expect.any(Object)
    );
  });

  it('should end session and navigate', async () => {
    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await act(async () => {
      await result.current.handleEndSession();
    });

    expect(mockEndSession).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith(`/campaign/${campaignId}`);
  });

  it('should handle error when ending session', async () => {
    mockEndSession.mockRejectedValue(new Error('End Session Fail'));

    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await act(async () => {
      await result.current.handleEndSession();
    });

    expect(handleAsyncError).toHaveBeenCalled();
  });

  it('should handle option selection', async () => {
    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    act(() => {
      result.current.handleOptionSelect('Option 1');
    });

    expect(result.current.currentMessage).toBe('Option 1');
  });

  it('should handle option double click', async () => {
    (AIService.chatWithDM as any).mockResolvedValue('Response');
    (AIService.getConversationHistory as any).mockResolvedValue([{ id: '1', role: 'assistant', content: 'Hi', timestamp: new Date() }]);

    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    act(() => {
      result.current.handleOptionDoubleClick('Option 2');
    });

    expect(result.current.currentMessage).toBe('Option 2');

    await waitFor(() => {
      expect(AIService.chatWithDM).toHaveBeenCalled();
    }, { timeout: 2000 });
  });

  it('should handle Enter key press', async () => {
    (AIService.getConversationHistory as any).mockResolvedValue([{ id: '1', role: 'assistant', content: 'Hi', timestamp: new Date() }]);
    (AIService.chatWithDM as any).mockResolvedValue('Response');

    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    act(() => {
      result.current.setCurrentMessage('Pressing Enter');
    });

    const mockEvent = {
      key: 'Enter',
      shiftKey: false,
      preventDefault: vi.fn(),
    } as any;

    await act(async () => {
      result.current.handleKeyPress(mockEvent);
    });

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(AIService.chatWithDM).toHaveBeenCalled();
  });

  it('should not send empty messages', async () => {
    (AIService.getConversationHistory as any).mockResolvedValue([{ id: '1', role: 'assistant', content: 'Hi', timestamp: new Date() }]);
    const { result } = renderHook(() =>
      useSimpleChatLogic({ campaignId, characterId })
    );

    await waitFor(() => {
      expect(result.current.isLoadingHistory).toBe(false);
    });

    await act(async () => {
      result.current.setCurrentMessage('   ');
      await result.current.sendMessage();
    });

    expect(AIService.chatWithDM).not.toHaveBeenCalled();
  });
});
