import { SAFETY_ENABLED } from './types';

import type { SafetyCommand } from './types';

import logger from '@/lib/logger';
import { issue1784Api } from '@/services/issue-1784-api';

/** Minimal session snapshot passed through to safety audit logging. */
export interface SafetySessionState {
  is_paused?: boolean;
  turn_count?: number;
}

export class SafetyAuditService {
  /**
   * Log a safety event to the audit trail
   */
  static async logSafetyEvent(
    sessionId: string,
    command: SafetyCommand,
    playerMessage?: string,
    aiResponse?: string,
    sessionState?: SafetySessionState,
    _userId?: string,
  ): Promise<void> {
    if (!SAFETY_ENABLED) {
      return;
    }
    try {
      // The server route authenticates the request and takes the user identity
      // from the verified WorkOS subject. Keep the legacy argument for callers
      // that still provide it, but never send it as a client-controlled field.
      const auditData = {
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
          command.type === 'pause' || command.type === 'x_card'
            ? true
            : command.type === 'resume'
              ? false
              : sessionState?.is_paused || false,
        session_turn_number: sessionState?.turn_count || 0,
      };

      await issue1784Api.recordSafetyEvent(sessionId, auditData);
      logger.info('🛡️ [Safety Audit] Safety event logged successfully:', {
        sessionId: sessionId,
        commandType: command.type,
        triggeredBy: command.triggeredBy,
        autoTriggered: command.autoTriggered,
      });

      // Also log locally for debugging
      logger.info('🛡️ [Safety Audit Local]', {
        sessionId: sessionId,
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

  private static getActionTaken(command: SafetyCommand): string {
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
