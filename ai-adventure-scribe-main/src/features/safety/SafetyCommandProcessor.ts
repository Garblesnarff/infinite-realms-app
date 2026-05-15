import { SafetyAuditService } from './SafetyAuditService';
import { SafetyResponseFactory } from './SafetyResponseFactory';
import { SAFETY_TRIGGER_WORDS } from './types';

import type {
  SafetyCommand,
  SessionConfig,
  TriggerWords,
  SafetyCommandResponse,
} from './types';
import type { ChatMessage } from '@/types/game';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

import { SAFETY_ENABLED } from './types';

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
      return SafetyResponseFactory.createXCardResponse(message.trim(), false);
    }

    // Check for explicit /veil command
    if (trimmedMessage === '/veil' || trimmedMessage.startsWith('/veil ')) {
      return SafetyResponseFactory.createVeilResponse(message.trim(), false);
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
      result = SafetyResponseFactory.createXCardResponse(
        `Auto-triggered by: ${xCardTrigger}`,
        true,
        xCardTrigger,
      );
    }
    // Check for Veil triggers
    else {
      const veilTrigger = this.findTriggerWordOptimized(combinedText, triggerWords.veil);
      if (veilTrigger) {
        result = SafetyResponseFactory.createVeilResponse(
          `Auto-triggered by: ${veilTrigger}`,
          true,
          veilTrigger,
        );
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
      return SafetyResponseFactory.createDisabledResponse();
    }
    logger.info(`🛡️ [Safety] Processing ${command.type} command:`, {
      type: command.type,
      triggeredBy: command.triggeredBy,
      autoTriggered: command.autoTriggered,
      context: command.context,
    });

    // Log to audit trail
    await SafetyAuditService.logSafetyEvent(
      this.sessionId,
      command,
      playerMessage,
      aiResponse,
      sessionState,
    );

    switch (command.type) {
      case 'x_card':
        return SafetyResponseFactory.createXCardResponse(
          command.context || '',
          command.autoTriggered || false,
          command.triggerWord,
        ).response!;

      case 'veil':
        return SafetyResponseFactory.createVeilResponse(
          command.context || '',
          command.autoTriggered || false,
          command.triggerWord,
        ).response!;

      case 'pause':
        return SafetyResponseFactory.createPauseResponse();

      case 'resume':
        return SafetyResponseFactory.createResumeResponse();

      default:
        return SafetyResponseFactory.createDefaultResponse();
    }
  }
}
