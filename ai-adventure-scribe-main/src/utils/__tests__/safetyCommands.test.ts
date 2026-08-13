/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable max-lines */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// We need to mock the safety types BEFORE importing safetyCommands to control SAFETY_ENABLED
let mockSafetyEnabled = true;
vi.mock('@/features/safety/types', async (importOriginal) => {
  const actual = await importOriginal<typeof SafetyTypesModule>();
  return {
    ...actual,
    get SAFETY_ENABLED() {
      return mockSafetyEnabled;
    },
  };
});

// Mock logger
vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock SafetyCommandProcessor to allow error injection
vi.mock('@/features/safety/SafetyCommandProcessor', async (importOriginal) => {
  const actual = await importOriginal<typeof SafetyCommandProcessorModule>();
  return {
    ...actual,
    SafetyCommandProcessor: vi.fn().mockImplementation((sessionId: string) => {
      return new (actual.SafetyCommandProcessor as any)(sessionId);
    }),
  };
});

import { checkSafetyCommands, processSafetyCommand } from '../safetyCommands';

import type * as SafetyCommandProcessorModule from '@/features/safety/SafetyCommandProcessor';
import type * as SafetyTypesModule from '@/features/safety/types';

import { SafetyCommandProcessor } from '@/features/safety/SafetyCommandProcessor';
import logger from '@/lib/logger';

// Mock Supabase client to avoid "supabaseUrl is required" error during module load
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
      })),
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  },
}));

describe('Safety Commands', () => {
  const sessionId = 'test-session-1';

  beforeEach(() => {
    vi.clearAllMocks();
    mockSafetyEnabled = true;
    // Reset SafetyCommandProcessor mock to default implementation
    vi.mocked(SafetyCommandProcessor).mockImplementation((_sessionId: string) => {
      // Use the actual implementation's prototype or a manual mock that behaves like the real thing
      // Since we want to test behavior, and the real thing is already tested,
      // we'll use a functional mock that matches the expected interface for standard tests
      return {
        checkExplicitSafetyCommands: vi.fn((msg) => {
          const trimmed = msg.trim().toLowerCase();
          if (trimmed === '/x' || trimmed.startsWith('/x '))
            return {
              isSafetyCommand: true,
              command: {
                type: 'x_card',
                triggeredBy: 'explicit_command',
                timestamp: new Date().toISOString(),
                context: msg.trim(),
              },
            };
          if (trimmed === '/veil' || trimmed.startsWith('/veil '))
            return {
              isSafetyCommand: true,
              command: {
                type: 'veil',
                triggeredBy: 'explicit_command',
                timestamp: new Date().toISOString(),
                context: msg.trim(),
              },
            };
          if (trimmed === '/pause' || trimmed.startsWith('/pause '))
            return {
              isSafetyCommand: true,
              command: {
                type: 'pause',
                triggeredBy: 'explicit_command',
                timestamp: new Date().toISOString(),
                context: msg.trim(),
              },
              shouldPause: true,
            };
          if (trimmed === '/resume' || trimmed.startsWith('/resume '))
            return {
              isSafetyCommand: true,
              command: {
                type: 'resume',
                triggeredBy: 'explicit_command',
                timestamp: new Date().toISOString(),
                context: msg.trim(),
              },
              shouldResume: true,
            };
          return { isSafetyCommand: false, shouldProcessNormal: true };
        }),
        checkAutoTriggerCommands: vi.fn((msg, ai) => {
          const combined = (msg + ' ' + (ai || '')).toLowerCase();
          if (combined.includes('violence'))
            return {
              isSafetyCommand: true,
              command: {
                type: 'x_card',
                triggeredBy: 'auto_detect',
                timestamp: new Date().toISOString(),
                autoTriggered: true,
                triggerWord: 'violence',
              },
              shouldPause: true,
            };
          if (combined.includes('suggestive'))
            return {
              isSafetyCommand: true,
              command: {
                type: 'veil',
                triggeredBy: 'auto_detect',
                timestamp: new Date().toISOString(),
                autoTriggered: true,
                triggerWord: 'suggestive',
              },
            };
          if (combined.includes('overwhelmed'))
            return {
              isSafetyCommand: true,
              command: {
                type: 'pause',
                triggeredBy: 'auto_detect',
                timestamp: new Date().toISOString(),
                autoTriggered: true,
                triggerWord: 'overwhelmed',
              },
              shouldPause: true,
            };
          return { isSafetyCommand: false, shouldProcessNormal: true };
        }),
        processSafetyCommand: vi.fn(async (cmd) => {
          return {
            text: `Processed ${cmd.type}`,
            sender: 'system',
            context: {
              intent: `safety_${cmd.type}`,
              autoTriggered: cmd.autoTriggered,
              triggerWord: cmd.triggerWord,
              urgency: cmd.type === 'x_card' ? 'immediate' : undefined,
            },
          };
        }),
      } as any;
    });
  });

  describe('checkSafetyCommands', () => {
    it('returns immediately if safety is disabled', async () => {
      mockSafetyEnabled = false;
      const result = await checkSafetyCommands('/x', sessionId);
      expect(result.isSafetyCommand).toBe(false);
      expect(result.shouldProcessNormal).toBe(true);
      expect(SafetyCommandProcessor).not.toHaveBeenCalled();
    });

    describe('Explicit Commands', () => {
      it('detects /x command', async () => {
        const result = await checkSafetyCommands('/x', sessionId);
        expect(result.isSafetyCommand).toBe(true);
        expect(result.command?.type).toBe('x_card');
        expect(result.command?.triggeredBy).toBe('explicit_command');
      });

      it('detects /x command with context', async () => {
        const result = await checkSafetyCommands('/x this is too graphic', sessionId);
        expect(result.isSafetyCommand).toBe(true);
        expect(result.command?.type).toBe('x_card');
        expect(result.command?.context).toBe('/x this is too graphic');
      });

      it('detects /veil command', async () => {
        const result = await checkSafetyCommands('/veil', sessionId);
        expect(result.isSafetyCommand).toBe(true);
        expect(result.command?.type).toBe('veil');
      });

      it('detects /pause command', async () => {
        const result = await checkSafetyCommands('/pause', sessionId);
        expect(result.isSafetyCommand).toBe(true);
        expect(result.command?.type).toBe('pause');
        expect(result.shouldPause).toBe(true);
      });

      it('detects /resume command', async () => {
        const result = await checkSafetyCommands('/resume', sessionId);
        expect(result.isSafetyCommand).toBe(true);
        expect(result.command?.type).toBe('resume');
        expect(result.shouldResume).toBe(true);
      });

      it('handles case sensitivity in commands', async () => {
        const result1 = await checkSafetyCommands('/X', sessionId);
        const result2 = await checkSafetyCommands('/PAUSE', sessionId);

        expect(result1.isSafetyCommand).toBe(true);
        expect(result2.isSafetyCommand).toBe(true);
      });
    });

    describe('Auto-triggered Commands', () => {
      it('detects x-card trigger words', async () => {
        const aiResponse = 'The scene contains graphic violence and blood.';
        const result = await checkSafetyCommands('This is uncomfortable', sessionId, aiResponse);

        expect(result.isSafetyCommand).toBe(true);
        expect(result.command?.type).toBe('x_card');
        expect(result.command?.autoTriggered).toBe(true);
      });

      it('returns false if no auto-triggered command is detected', async () => {
        const result = await checkSafetyCommands('Safe message', sessionId, 'Safe response');
        expect(result.isSafetyCommand).toBe(false);
        expect(result.shouldProcessNormal).toBe(true);
      });
    });

    describe('Error Handling', () => {
      it('handles errors by using fallback detection', async () => {
        const error = new Error('Processor failed');
        vi.mocked(SafetyCommandProcessor).mockImplementationOnce(() => {
          throw error;
        });

        const result = await checkSafetyCommands('/pause', sessionId);

        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error in safety command check'),
          error,
        );
        expect(result.isSafetyCommand).toBe(true);
        expect(result.command?.type).toBe('pause');
        expect(result.command?.triggeredBy).toBe('fallback_detection');
        expect(result.command?.context).toContain(
          'Fallback detection due to error: Processor failed',
        );
      });

      it('returns normal processing if fallback detection finds nothing on error', async () => {
        vi.mocked(SafetyCommandProcessor).mockImplementationOnce(() => {
          throw new Error('Processor failed');
        });

        const result = await checkSafetyCommands('Normal message', sessionId);
        expect(result.isSafetyCommand).toBe(false);
        expect(result.shouldProcessNormal).toBe(true);
      });

      it('detects all fallback commands correctly', async () => {
        vi.mocked(SafetyCommandProcessor).mockImplementation(() => {
          throw new Error('Processor failed');
        });

        const commands = [
          { input: '/x_card', expected: 'x_card' },
          { input: '/veil', expected: 'veil' },
          { input: '/pause', expected: 'pause' },
          { input: '/resume', expected: 'resume' },
          { input: '/x_card ', expected: 'x_card' },
          { input: '/x_card some context', expected: 'x_card' },
        ];

        for (const cmd of commands) {
          const result = await checkSafetyCommands(cmd.input, sessionId);
          expect(result.isSafetyCommand).toBe(true);
          expect(result.command?.type).toBe(cmd.expected);
        }
      });

      it('handles non-Error objects in catch block', async () => {
        vi.mocked(SafetyCommandProcessor).mockImplementationOnce(() => {
          const nonError: unknown = 'Something went wrong';
          throw nonError;
        });

        const result = await checkSafetyCommands('/veil', sessionId);
        expect(result.isSafetyCommand).toBe(true);
        expect(result.command?.type).toBe('veil');
        expect(result.command?.context).toContain('Unknown error');
      });
    });
  });

  describe('processSafetyCommand', () => {
    it('returns immediately if safety is disabled', async () => {
      mockSafetyEnabled = false;
      const command = { type: 'pause' as any, triggeredBy: 'test', timestamp: '' };
      const response = await processSafetyCommand(command, sessionId);
      expect(response.text).toContain('Safety command ignored');
      expect(response.context?.intent).toBe('safety_disabled');
    });

    it('processes command correctly', async () => {
      const command = {
        type: 'x_card' as const,
        triggeredBy: 'explicit_command',
        timestamp: '2025-10-08T12:00:00Z',
        context: '/x',
      };

      const response = await processSafetyCommand(command, sessionId);

      expect(response.sender).toBe('system');
      expect(response.text).toContain('Processed x_card');
    });

    describe('Error Handling', () => {
      it('handles errors by using fallback responses', async () => {
        const error = new Error('Processing failed');
        vi.mocked(SafetyCommandProcessor).mockImplementationOnce(
          () =>
            ({
              processSafetyCommand: vi.fn().mockRejectedValue(error),
            }) as any,
        );

        const command = { type: 'pause' as any, triggeredBy: 'test', timestamp: '' };
        const response = await processSafetyCommand(command, sessionId);

        expect(logger.error).toHaveBeenCalledWith(
          expect.stringContaining('Error processing safety command'),
          error,
        );
        expect(response.sender).toBe('system');
        expect(response.context?.intent).toBe('safety_fallback');
        expect(response.text).toContain('GAME PAUSED');
      });

      it('provides specific fallback for each command type', async () => {
        vi.mocked(SafetyCommandProcessor).mockImplementation(
          () =>
            ({
              processSafetyCommand: vi.fn().mockRejectedValue(new Error('fail')),
            }) as any,
        );

        const testCases = [
          { type: 'x_card', expected: 'SAFETY ACTIVATED' },
          { type: 'veil', expected: 'SAFETY VEIL' },
          { type: 'pause', expected: 'GAME PAUSED' },
          { type: 'resume', expected: 'GAME RESUMED' },
          { type: 'unknown' as any, expected: 'SAFETY ACTIVATED' }, // default case
        ];

        for (const tc of testCases) {
          const command = { type: tc.type, triggeredBy: 'test', timestamp: '' };
          const response = await processSafetyCommand(command, sessionId);
          expect(response.text).toContain(tc.expected);
        }
      });

      it('handles non-Error objects in catch block', async () => {
        vi.mocked(SafetyCommandProcessor).mockImplementationOnce(
          () =>
            ({
              processSafetyCommand: vi.fn().mockRejectedValue('String error'),
            }) as any,
        );

        const command = { type: 'x_card' as any, triggeredBy: 'test', timestamp: '' };
        const response = await processSafetyCommand(command, sessionId);
        expect(response.context?.error).toBe('Unknown error');
      });
    });
  });
});
