import type {
  SafetyCommand,
  SessionConfig,
  TriggerWords,
  SafetyCommandResponse} from '@/features/safety/types';
import type { ChatMessage } from '@/types/game';

import {
  SafetyCommandProcessor,
  SAFETY_ENABLED,
} from '@/features/safety/SafetyCommandProcessor';
import {
  SAFETY_TRIGGER_WORDS,
} from '@/features/safety/types';
import logger from '@/lib/logger';

// Re-export types for backward compatibility
export type { SafetyCommand, SessionConfig, TriggerWords, SafetyCommandResponse };
export { SafetyCommandProcessor, SAFETY_ENABLED, SAFETY_TRIGGER_WORDS };

/**
 * Check if a message contains safety commands (both explicit and auto-triggered)
 */
export async function checkSafetyCommands(
  message: string,
  sessionId: string,
  aiResponse?: string,
): Promise<SafetyCommandResponse> {
  if (!SAFETY_ENABLED) {
    return { isSafetyCommand: false, shouldProcessNormal: true };
  }
  try {
    const processor = new SafetyCommandProcessor(sessionId);

    // First check for explicit commands
    const explicitCheck = processor.checkExplicitSafetyCommands(message);
    if (explicitCheck.isSafetyCommand) {
      return explicitCheck;
    }

    // Then check for auto-triggered commands (async)
    const autoCheck = await processor.checkAutoTriggerCommands(message, aiResponse);
    if (autoCheck.isSafetyCommand) {
      return autoCheck;
    }

    return { isSafetyCommand: false, shouldProcessNormal: true };
  } catch (error) {
    logger.error('🛡️ [Safety] Error in safety command check, defaulting to safe mode:', error);

    // On error, check for critical safety commands manually
    const criticalCommands = ['x_card', 'veil', 'pause', 'resume'];
    const trimmedMessage = message.trim().toLowerCase();

    for (const cmd of criticalCommands) {
      if (
        trimmedMessage === `/${cmd}` ||
        trimmedMessage === `/${cmd} ` ||
        trimmedMessage.startsWith(`/${cmd} `)
      ) {
        return {
          isSafetyCommand: true,
          command: {
            type: cmd as any,
            triggeredBy: 'fallback_detection',
            timestamp: new Date().toISOString(),
            context: `Fallback detection due to error: ${error instanceof Error ? error.message : 'Unknown error'}`,
            autoTriggered: false,
          },
        };
      }
    }

    return { isSafetyCommand: false, shouldProcessNormal: true };
  }
}

/**
 * Process a safety command and return the response message with error recovery
 */
export async function processSafetyCommand(
  command: SafetyCommand,
  sessionId: string,
  playerMessage?: string,
  aiResponse?: string,
  sessionState?: any,
): Promise<ChatMessage> {
  if (!SAFETY_ENABLED) {
    return {
      text: 'Safety command ignored (guardrails disabled).',
      sender: 'system',
      context: {
        intent: 'safety_disabled',
      },
    };
  }
  try {
    const processor = new SafetyCommandProcessor(sessionId);
    return await processor.processSafetyCommand(command, playerMessage, aiResponse, sessionState);
  } catch (error) {
    logger.error('🛡️ [Safety] Error processing safety command, using fallback:', error);

    // Fallback safety response - always ensure safety messages get through
    const fallbackResponses: Record<string, string> = {
      x_card:
        '🚨 **SAFETY ACTIVATED** 🚨\n\nThe safety system has been triggered. Content has been stopped for your comfort and safety.',
      veil: '🌫️ **SAFETY VEIL** 🌫️\n\nContent has been blurred to maintain comfort while preserving the narrative.',
      pause:
        '⏸️ **GAME PAUSED** ⏸️\n\nThe game has been paused for your comfort. Take your time and use /resume when ready.',
      resume: "▶️ **GAME RESUMED** ▶️\n\nWelcome back! We'll continue from where we left off.",
    };

    const response = fallbackResponses[command.type] || fallbackResponses.x_card;

    return {
      text: response,
      sender: 'system',
      context: {
        intent: 'safety_fallback',
        originalCommand: command.type,
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
    };
  }
}
