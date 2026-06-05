import { SAFETY_ENABLED } from './types';

import type { SafetyCommand } from './types';

import { supabase } from '@/integrations/supabase/client';
import logger from '@/lib/logger';

export class SafetyAuditService {
  /**
   * Log a safety event to the audit trail
   */
  static async logSafetyEvent(
    sessionId: string,
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
        session_id: sessionId,
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
          command.type === 'pause' || command.type === 'x_card'
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
          sessionId: sessionId,
          commandType: command.type,
          triggeredBy: command.triggeredBy,
          autoTriggered: command.autoTriggered,
        });
      }

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
