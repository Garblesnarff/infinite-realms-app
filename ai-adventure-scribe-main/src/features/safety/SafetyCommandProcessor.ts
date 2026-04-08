import {
  SAFETY_TRIGGER_WORDS,
} from './types';

import type {
  SafetyCommand,
  SessionConfig,
  TriggerWords,
  SafetyCommandResponse} from './types';
import type { ChatMessage } from '@/types/game';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

export const SAFETY_ENABLED =
  String(import.meta.env.VITE_ENABLE_SAFETY_GUARDS ?? '').toLowerCase() === 'true' ||
  import.meta.env.MODE === 'test';

export class SafetyCommandProcessor {
  private sessionId: string;
  private safetyConfig?: SessionConfig; // Will be populated from session_config
  private configCacheExpiry: number = 0;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  private async loadSessionConfig(): Promise<SessionConfig | null> {
    if (!SAFETY_ENABLED) {
      return null;
    }
    // Cache config for 5 minutes
    if (this.safetyConfig && Date.now() < this.configCacheExpiry) {
      return this.safetyConfig;
    }

    try {
      const { data, error } = await supabase
        .from('session_config')
        .select('*')
        .eq('session_id', this.sessionId)
        .single();

      if (error) {
        const code = (error as { code?: string }).code;
        const status = (error as { status?: number }).status;
        if (code === 'PGRST205' || code === 'PGRST103' || code === '42P01' || status === 404) {
          logger.warn('🛡️ [Safety] session_config table not available, using defaults');
          return null;
        }
        logger.warn('🛡️ [Safety] Failed to load session config, using defaults:', error);
        return null;
      }

      this.safetyConfig = data as SessionConfig;
      this.configCacheExpiry = Date.now() + 5 * 60 * 1000; // 5 minutes
      return this.safetyConfig;
    } catch (error) {
      logger.error('🛡️ [Safety] Error loading session config:', error);
      return null;
    }
  }

  private async getTriggerWords(): Promise<TriggerWords> {
    if (!SAFETY_ENABLED) {
      return { ...SAFETY_TRIGGER_WORDS };
    }
    const config = await this.loadSessionConfig();

    const defaultTriggers = { ...SAFETY_TRIGGER_WORDS };

    if (!config) {
      return defaultTriggers;
    }

    // If strict mode is enabled and custom triggers exist, use only custom triggers
    if (config.strict_mode_triggers) {
      return {
        x_card:
          config.custom_x_card_triggers?.length > 0
            ? config.custom_x_card_triggers
            : defaultTriggers.x_card,
        veil:
          config.custom_veil_triggers?.length > 0
            ? config.custom_veil_triggers
            : defaultTriggers.veil,
        pause:
          config.custom_pause_triggers?.length > 0
            ? config.custom_pause_triggers
            : defaultTriggers.pause,
      };
    }

    // Otherwise, merge custom triggers with defaults
    return {
      x_card: [...new Set([...defaultTriggers.x_card, ...(config.custom_x_card_triggers || [])])],
      veil: [...new Set([...defaultTriggers.veil, ...(config.custom_veil_triggers || [])])],
      pause: [...new Set([...defaultTriggers.pause, ...(config.custom_pause_triggers || [])])],
    };
  }

  /**
   * Check if message contains explicit safety commands
   */
  checkExplicitSafetyCommands(message: string): SafetyCommandResponse {
    if (!SAFETY_ENABLED) {
      return { isSafetyCommand: false, shouldProcessNormal: true };
    }
    const trimmedMessage = message.trim().toLowerCase();

    // Check for explicit /x command
    if (trimmedMessage === '/x' || trimmedMessage.startsWith('/x ')) {
      return this.createXCardResponse(message.trim(), false);
    }

    // Check for explicit /veil command
    if (trimmedMessage === '/veil' || trimmedMessage.startsWith('/veil ')) {
      return this.createVeilResponse(message.trim(), false);
    }

    // Check for explicit /pause command
    if (trimmedMessage === '/pause' || trimmedMessage.startsWith('/pause ')) {
      return {
        isSafetyCommand: true,
        command: {
          type: 'pause',
          triggeredBy: 'explicit_command',
          timestamp: new Date().toISOString(),
          context: message.trim(),
        },
        shouldPause: true,
      };
    }

    // Check for explicit /resume command
    if (trimmedMessage === '/resume' || trimmedMessage.startsWith('/resume ')) {
      return {
        isSafetyCommand: true,
        command: {
          type: 'resume',
          triggeredBy: 'explicit_command',
          timestamp: new Date().toISOString(),
          context: message.trim(),
        },
        shouldResume: true,
      };
    }

    return { isSafetyCommand: false, shouldProcessNormal: true };
  }

  /**
   * Check for auto-triggered safety commands based on content analysis
   */
  async checkAutoTriggerCommands(
    message: string,
    aiResponse?: string,
  ): Promise<SafetyCommandResponse> {
    if (!SAFETY_ENABLED) {
      return { isSafetyCommand: false, shouldProcessNormal: true };
    }
    const combinedText = message.toLowerCase() + ' ' + (aiResponse?.toLowerCase() || '');

    // Get configurable trigger words
    const triggerWords = await this.getTriggerWords();

    let result: SafetyCommandResponse;

    // Check for X-card triggers
    const xCardTrigger = this.findTriggerWordOptimized(combinedText, triggerWords.x_card);
    if (xCardTrigger) {
      result = this.createXCardResponse(`Auto-triggered by: ${xCardTrigger}`, true, xCardTrigger);
    }
    // Check for Veil triggers
    else {
      const veilTrigger = this.findTriggerWordOptimized(combinedText, triggerWords.veil);
      if (veilTrigger) {
        result = this.createVeilResponse(`Auto-triggered by: ${veilTrigger}`, true, veilTrigger);
      }
      // Check for Pause triggers
      else {
        const pauseTrigger = this.findTriggerWordOptimized(combinedText, triggerWords.pause);
        if (pauseTrigger) {
          result = {
            isSafetyCommand: true,
            command: {
              type: 'pause',
              triggeredBy: 'auto_detect',
              timestamp: new Date().toISOString(),
              context: `Auto-triggered by: ${pauseTrigger}`,
              autoTriggered: true,
              triggerWord: pauseTrigger,
            },
            shouldPause: true,
          };
        } else {
          result = { isSafetyCommand: false, shouldProcessNormal: true };
        }
      }
    }

    return result;
  }

  private findTriggerWordOptimized(text: string, triggerWords: string[]): string | null {
    // Optimize by checking longer words first and using early exit
    const sortedTriggers = [...triggerWords].sort((a, b) => b.length - a.length);

    for (const trigger of sortedTriggers) {
      if (text.includes(trigger)) {
        return trigger;
      }
    }
    return null;
  }

  private findTriggerWord(text: string, triggerWords: string[]): string | null {
    // Keep original for backwards compatibility
    const words = text.toLowerCase().split(/\s+/);
    for (const trigger of triggerWords) {
      if (words.some((word) => word.includes(trigger) || trigger.includes(word))) {
        return trigger;
      }
    }
    return null;
  }

  private createXCardResponse(
    context: string,
    autoTriggered: boolean,
    triggerWord?: string,
  ): SafetyCommandResponse {
    return {
      isSafetyCommand: true,
      command: {
        type: 'x_card',
        triggeredBy: autoTriggered ? 'auto_detect' : 'explicit_command',
        timestamp: new Date().toISOString(),
        context,
        autoTriggered,
        triggerWord,
      },
      response: {
        text: '🚨 **X-CARD ACTIVATED** 🚨\n\nThe scene has been immediately stopped. The content will be rewound to before the uncomfortable element. We can take a break or continue in a different direction that works for everyone.\n\nYour comfort and safety are the priority. Please take care of yourself.',
        sender: 'system',
        context: {
          intent: 'safety_x_card',
          urgency: 'immediate',
          autoTriggered,
          triggerWord,
        },
      },
      shouldPause: true,
    };
  }

  private createVeilResponse(
    context: string,
    autoTriggered: boolean,
    triggerWord?: string,
  ): SafetyCommandResponse {
    return {
      isSafetyCommand: true,
      command: {
        type: 'veil',
        triggeredBy: autoTriggered ? 'auto_detect' : 'explicit_command',
        timestamp: new Date().toISOString(),
        context,
        autoTriggered,
        triggerWord,
      },
      response: {
        text: "🌫️ **VEIL ACTIVATED** 🌫️\n\nThe sensitive content has been faded or skipped. We'll acknowledge what happened off-screen and move to the aftermath or a different scene element.\n\nWe're redirecting to maintain comfort while preserving the narrative flow.",
        sender: 'system',
        context: {
          intent: 'safety_veil',
          urgency: 'moderate',
          autoTriggered,
          triggerWord,
        },
      },
    };
  }

  /**
   * Process a safety command and return appropriate response
   */
  async processSafetyCommand(
    command: SafetyCommand,
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
    logger.info(`🛡️ [Safety] Processing ${command.type} command:`, {
      type: command.type,
      triggeredBy: command.triggeredBy,
      autoTriggered: command.autoTriggered,
      context: command.context,
    });

    // Log to audit trail
    await this.logSafetyEvent(command, playerMessage, aiResponse, sessionState);

    switch (command.type) {
      case 'x_card':
        return this.createXCardResponse(
          command.context || '',
          command.autoTriggered || false,
          command.triggerWord,
        ).response!;

      case 'veil':
        return this.createVeilResponse(
          command.context || '',
          command.autoTriggered || false,
          command.triggerWord,
        ).response!;

      case 'pause':
        return {
          text: "⏸️ **GAME PAUSED** ⏸️\n\nThe game has been paused. Take all the time you need. Use /resume when you're ready to continue.\n\nYour comfort is important. We'll wait as long as needed.",
          sender: 'system',
          context: {
            intent: 'safety_pause',
            urgency: 'moderate',
          },
        };

      case 'resume':
        return {
          text: "▶️ **GAME RESUMED** ▶️\n\nWelcome back! Let's continue from where we left off. If anything becomes uncomfortable, remember you can always use the safety commands.\n\nWhat would you like to do next?",
          sender: 'system',
          context: {
            intent: 'safety_resume',
          },
        };

      default:
        return {
          text: 'Safety command processed. Your comfort and safety are the priority.',
          sender: 'system',
          context: {
            intent: 'safety_generic',
          },
        };
    }
  }

  /**
   * @param userId - User ID for audit logging (SECURITY: strongly recommended)
   */
  private async logSafetyEvent(
    command: SafetyCommand,
    playerMessage?: string,
    aiResponse?: string,
    sessionState?: any,
    userId?: string,
  ): Promise<void> {
    if (!SAFETY_ENABLED) {
      return;
    }
    try {
      // SECURITY: Use provided userId instead of Supabase auth (WorkOS is used)
      if (!userId) {
        logger.warn('🛡️ [Safety Audit] No userId provided for audit log - this is insecure');
        return;
      }

      // Get session info for audit context
      const auditData = {
        session_id: this.sessionId,
        user_id: userId,
        event_type: command.type,
        triggered_by: command.triggeredBy,
        trigger_word: command.triggerWord,
        player_message: playerMessage?.substring(0, 1000) || null, // Limit size
        ai_response: aiResponse?.substring(0, 1000) || null, // Limit size
        context_snippet: command.context?.substring(0, 500) || null,
        auto_triggered: command.autoTriggered || false,
        confidence_score: command.autoTriggered ? 0.8 : 1.0, // Auto-triggers get lower confidence
        system_response: `${command.type} - ${command.context || 'Safety command processed'}`,
        action_taken: this.getActionTaken(command),
        was_paused_before: sessionState?.is_paused || false,
        is_paused_after:
          command.type === 'pause'
            ? true
            : command.type === 'resume'
              ? false
              : sessionState?.is_paused || false,
        session_turn_number: sessionState?.turn_count || 0,
      };

      // Insert into audit trail
      const { error: insertError } = await supabase.from('safety_audit_trail').insert(auditData);

      if (insertError) {
        logger.error('🛡️ [Safety Audit] Failed to log safety event:', insertError);
      } else {
        logger.info('🛡️ [Safety Audit] Safety event logged successfully:', {
          sessionId: this.sessionId,
          commandType: command.type,
          triggeredBy: command.triggeredBy,
          autoTriggered: command.autoTriggered,
        });
      }

      // Also log locally for debugging
      logger.info('🛡️ [Safety Audit Local]', {
        sessionId: this.sessionId,
        timestamp: command.timestamp,
        commandType: command.type,
        triggeredBy: command.triggeredBy,
        autoTriggered: command.autoTriggered,
        context: command.context,
        triggerWord: command.triggerWord,
      });
    } catch (error) {
      logger.error('🛡️ [Safety Audit] Error logging safety event:', error);
    }
  }

  private getActionTaken(command: SafetyCommand): string {
    switch (command.type) {
      case 'x_card':
        return 'rewound_content';
      case 'veil':
        return 'veiled_content';
      case 'pause':
        return 'paused_session';
      case 'resume':
        return 'resumed_session';
      default:
        return 'logged_only';
    }
  }
}
