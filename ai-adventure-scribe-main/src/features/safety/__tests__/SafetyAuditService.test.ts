/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SafetyAuditService } from '../SafetyAuditService';
import { SAFETY_ENABLED } from '../types';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

// Mock Logger
vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('SafetyAuditService', () => {
  const sessionId = 'test-session-123';
  const userId = 'user-456';
  const mockInsert = vi.fn().mockResolvedValue({ error: null });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.from).mockReturnValue({
      insert: mockInsert,
    } as any);
  });

  it('should have SAFETY_ENABLED as true in test environment', () => {
    expect(SAFETY_ENABLED).toBe(true);
  });

  describe('logSafetyEvent', () => {
    it('should return early and warn if no userId is provided', async () => {
      const command: any = { type: 'pause', triggeredBy: 'player' };

      await SafetyAuditService.logSafetyEvent(sessionId, command);

      expect(supabase.from).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No userId provided'));
    });

    it('should successfully log a pause event', async () => {
      const command: any = {
        type: 'pause',
        triggeredBy: 'explicit_command',
        timestamp: new Date().toISOString(),
        context: '/pause',
      };
      const playerMessage = 'I need a break';
      const sessionState = { is_paused: false, turn_count: 5 };

      await SafetyAuditService.logSafetyEvent(
        sessionId,
        command,
        playerMessage,
        undefined,
        sessionState,
        userId
      );

      expect(supabase.from).toHaveBeenCalledWith('safety_audit_trail');
      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        session_id: sessionId,
        user_id: userId,
        event_type: 'pause',
        player_message: playerMessage,
        is_paused_after: true,
        was_paused_before: false,
        session_turn_number: 5,
      }));
    });

    it('should successfully log a resume event', async () => {
      const command: any = {
        type: 'resume',
        triggeredBy: 'explicit_command',
        timestamp: new Date().toISOString(),
      };
      const sessionState = { is_paused: true, turn_count: 10 };

      await SafetyAuditService.logSafetyEvent(
        sessionId,
        command,
        undefined,
        undefined,
        sessionState,
        userId
      );

      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'resume',
        is_paused_after: false,
        was_paused_before: true,
      }));
    });

    it('should truncate long messages', async () => {
      const longMessage = 'a'.repeat(2000);
      const longContext = 'b'.repeat(1000);
      const command: any = {
        type: 'veil',
        triggeredBy: 'auto_detect',
        context: longContext,
        triggerWord: 'word',
      };

      await SafetyAuditService.logSafetyEvent(
        sessionId,
        command,
        longMessage, // playerMessage
        longMessage, // aiResponse
        {},
        userId
      );

      const calledWith = mockInsert.mock.calls[0][0];
      expect(calledWith.player_message.length).toBe(1000);
      expect(calledWith.ai_response.length).toBe(1000);
      expect(calledWith.context_snippet.length).toBe(500);
    });

    it('should handle x_card command and log it', async () => {
      const command: any = {
        type: 'x_card',
        triggeredBy: 'explicit_command',
        context: 'uncomfortable scene',
      };

      await SafetyAuditService.logSafetyEvent(sessionId, command, 'stop', undefined, { is_paused: false }, userId);

      expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
        event_type: 'x_card',
        action_taken: 'rewound_content',
      }));
    });

    it('should correctly set is_paused_after to true for x_card', async () => {
       const command: any = { type: 'x_card' };

       await SafetyAuditService.logSafetyEvent(sessionId, command, '', '', { is_paused: false }, userId);
       expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({
           is_paused_after: true
       }));
    });

    it('should log error when Supabase insert fails', async () => {
      const error = { message: 'Insert failed' };
      mockInsert.mockResolvedValueOnce({ error });

      const command: any = { type: 'pause' };
      await SafetyAuditService.logSafetyEvent(sessionId, command, '', '', {}, userId);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to log safety event'), error);
    });

    it('should catch and log unexpected errors', async () => {
      mockInsert.mockImplementationOnce(() => { throw new Error('Boom'); });

      const command: any = { type: 'pause' };
      await SafetyAuditService.logSafetyEvent(sessionId, command, '', '', {}, userId);

      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('Error logging safety event'), expect.any(Error));
    });
  });

  describe('getActionTaken', () => {
    it('should return correct action strings for each command type', () => {
      // Access private method for thorough testing
      const getActionTaken = (SafetyAuditService as any).getActionTaken;

      expect(getActionTaken({ type: 'x_card' })).toBe('rewound_content');
      expect(getActionTaken({ type: 'veil' })).toBe('veiled_content');
      expect(getActionTaken({ type: 'pause' })).toBe('paused_session');
      expect(getActionTaken({ type: 'resume' })).toBe('resumed_session');
      expect(getActionTaken({ type: 'unknown' })).toBe('logged_only');
    });
  });
});
