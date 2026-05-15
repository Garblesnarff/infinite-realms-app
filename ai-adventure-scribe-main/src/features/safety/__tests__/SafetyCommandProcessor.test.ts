/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { SafetyCommandProcessor } from '../SafetyCommandProcessor';
import { SafetyAuditService } from '../SafetyAuditService';
import { SAFETY_ENABLED } from '../types';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

// Mock Supabase
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(),
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

describe('SafetyCommandProcessor', () => {
  const sessionId = 'test-session-123';
  let processor: SafetyCommandProcessor;
  const mockSupabaseChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockResolvedValue({ error: null }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(supabase.from).mockReturnValue(mockSupabaseChain as any);
    processor = new SafetyCommandProcessor(sessionId);
    // Force cache clearing for each test
    (processor as any).configCacheExpiry = 0;
    (processor as any).safetyConfig = undefined;
  });

  it('should have SAFETY_ENABLED as true in test environment', () => {
    expect(SAFETY_ENABLED).toBe(true);
  });

  describe('checkExplicitSafetyCommands', () => {
    it('should detect explicit /x command', () => {
      const result = processor.checkExplicitSafetyCommands('/x stop this');
      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('x_card');
      expect(result.command?.triggeredBy).toBe('explicit_command');
      expect(result.response?.text).toContain('X-CARD ACTIVATED');
    });

    it('should detect explicit /veil command', () => {
      const result = processor.checkExplicitSafetyCommands('/veil too much info');
      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('veil');
      expect(result.command?.triggeredBy).toBe('explicit_command');
      expect(result.response?.text).toContain('VEIL ACTIVATED');
    });

    it('should detect explicit /pause command', () => {
      const result = processor.checkExplicitSafetyCommands('/pause');
      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('pause');
      expect(result.shouldPause).toBe(true);
    });

    it('should detect explicit /resume command', () => {
      const result = processor.checkExplicitSafetyCommands('/resume');
      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('resume');
      expect(result.shouldResume).toBe(true);
    });

    it('should handle variations of command spacing and case', () => {
      expect(processor.checkExplicitSafetyCommands('/X').isSafetyCommand).toBe(true);
      expect(processor.checkExplicitSafetyCommands('/veil ').isSafetyCommand).toBe(true);
      expect(processor.checkExplicitSafetyCommands(' /pause ').isSafetyCommand).toBe(true);
    });

    it('should return isSafetyCommand false for normal messages', () => {
      const result = processor.checkExplicitSafetyCommands('Hello world');
      expect(result.isSafetyCommand).toBe(false);
      expect(result.shouldProcessNormal).toBe(true);
    });
  });

  describe('checkAutoTriggerCommands', () => {
    it('should detect x-card triggers in message or AI response', async () => {
      const result = await processor.checkAutoTriggerCommands('there is blood everywhere');
      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('x_card');
      expect(result.command?.triggerWord).toBe('blood');
      expect(result.shouldPause).toBe(true);
    });

    it('should detect veil triggers', async () => {
      const result = await processor.checkAutoTriggerCommands('this is suggestive content');
      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('veil');
      expect(result.command?.triggerWord).toBe('suggestive');
    });

    it('should detect pause triggers', async () => {
      const result = await processor.checkAutoTriggerCommands('i am overwhelmed');
      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('pause');
      expect(result.command?.triggerWord).toBe('overwhelmed');
    });

    it('should load custom triggers from session config', async () => {
      const mockConfig = {
        custom_x_card_triggers: ['forbidden'],
        strict_mode_triggers: false,
      };

      mockSupabaseChain.single.mockResolvedValueOnce({ data: mockConfig, error: null });

      const result = await processor.checkAutoTriggerCommands('this is forbidden');
      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('x_card');
      expect(result.command?.triggerWord).toBe('forbidden');
    });

    it('should respect strict mode triggers', async () => {
      const mockConfig = {
        custom_x_card_triggers: ['onlythis'],
        strict_mode_triggers: true,
      };

      mockSupabaseChain.single.mockResolvedValueOnce({ data: mockConfig, error: null });

      // 'blood' is a default trigger, should be ignored in strict mode if not in custom list
      const result = await processor.checkAutoTriggerCommands('there is blood');
      expect(result.isSafetyCommand).toBe(false);

      // Need to clear cache/mock again because we are in the same test but want different call
      (processor as any).safetyConfig = undefined;
      mockSupabaseChain.single.mockResolvedValueOnce({ data: mockConfig, error: null });
      const result2 = await processor.checkAutoTriggerCommands('this is onlythis');
      expect(result2.isSafetyCommand).toBe(true);
    });

    it('should handle config load errors gracefully and use defaults', async () => {
      mockSupabaseChain.single.mockResolvedValueOnce({ data: null, error: { message: 'Database error', status: 500 } as any });

      const result = await processor.checkAutoTriggerCommands('there is blood');
      expect(result.isSafetyCommand).toBe(true);
      expect(result.command?.type).toBe('x_card');
      expect(vi.mocked(logger.warn)).toHaveBeenCalled();
    });
  });

  describe('processSafetyCommand', () => {
    it('should process x_card command and return system message', async () => {
      const command: any = {
        type: 'x_card',
        triggeredBy: 'explicit_command',
        context: '/x',
      };

      const response = await processor.processSafetyCommand(command);
      expect(response.sender).toBe('system');
      expect(response.text).toContain('X-CARD ACTIVATED');
    });

    it('should process veil command', async () => {
      const command: any = {
        type: 'veil',
        triggeredBy: 'explicit_command',
        context: '/veil',
      };

      const response = await processor.processSafetyCommand(command);
      expect(response.sender).toBe('system');
      expect(response.text).toContain('VEIL ACTIVATED');
    });

    it('should process pause command', async () => {
      const command: any = {
        type: 'pause',
        triggeredBy: 'explicit_command',
      };

      const response = await processor.processSafetyCommand(command);
      expect(response.text).toContain('GAME PAUSED');
    });

    it('should process resume command', async () => {
      const command: any = {
        type: 'resume',
        triggeredBy: 'explicit_command',
      };

      const response = await processor.processSafetyCommand(command);
      expect(response.text).toContain('GAME RESUMED');
    });

    it('should log to audit trail if userId is NOT provided (warning case)', async () => {
      const command: any = {
        type: 'x_card',
        triggeredBy: 'explicit_command',
        timestamp: new Date().toISOString(),
      };

      await processor.processSafetyCommand(command);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(expect.stringContaining('No userId provided for audit log'));
    });

    it('should log successfully if userId is provided via SafetyAuditService', async () => {
        const command: any = {
          type: 'x_card',
          triggeredBy: 'explicit_command',
          timestamp: new Date().toISOString(),
        };

        mockSupabaseChain.insert.mockResolvedValueOnce({ error: null });

        await SafetyAuditService.logSafetyEvent(sessionId, command, 'player msg', 'ai msg', {}, 'user-123');

        expect(supabase.from).toHaveBeenCalledWith('safety_audit_trail');
        expect(mockSupabaseChain.insert).toHaveBeenCalledWith(expect.objectContaining({
            user_id: 'user-123',
            event_type: 'x_card'
        }));
    });
  });

  describe('findTriggerWordOptimized', () => {
      it('should find the longest trigger word first', () => {
          const triggers = ['blood', 'bloody'];
          const text = 'it was very bloody';
          // Access private method
          const result = (processor as any).findTriggerWordOptimized(text, triggers);
          expect(result).toBe('bloody');
      });

      it('should return null if no trigger word matches', () => {
          const triggers = ['blood', 'gore'];
          const text = 'hello world';
          const result = (processor as any).findTriggerWordOptimized(text, triggers);
          expect(result).toBe(null);
      });
  });
});
