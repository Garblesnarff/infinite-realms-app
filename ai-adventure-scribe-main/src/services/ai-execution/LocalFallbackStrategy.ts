import type { AIExecutionStrategy } from './AIExecutionStrategy';

import logger from '@/lib/logger';
import { AIService } from '@/services/ai-service';

interface DMRunPayload {
  task?: { description?: string };
  agentContext?: {
    campaignDetails?: Record<string, unknown>;
    characterDetails?: Record<string, unknown>;
    narrativeResponse?: Record<string, unknown>;
  };
}

// Per-session cooldown for combat DM narration (5s)
let lastGlobalNarrationAt = 0;
const NARRATION_COOLDOWN_MS = 5000;

export class LocalFallbackStrategy implements AIExecutionStrategy {
  readonly name = 'local-fallback';
  readonly priority: number;

  constructor(priority: number = 5) {
    this.priority = priority;
  }

  canExecute(functionName: string): boolean {
    return functionName === 'dm-agent-execute' || functionName === 'rules-interpreter-execute';
  }

  async execute(functionName: string, payload?: Record<string, unknown>): Promise<unknown> {
    if (functionName === 'rules-interpreter-execute') {
      return this.executeRulesInterpreter();
    }
    return this.executeDMAgent(payload as DMRunPayload);
  }

  private async executeDMAgent(payload: DMRunPayload | undefined) {
    // Check feature flag for combat DM narration
    const enableCombatNarration = import.meta.env.VITE_ENABLE_COMBAT_DM_NARRATION === 'true';

    // For combat events, apply cooldown and feature flag logic
    const isCombatEvent =
      payload?.task?.description?.includes('combat') ||
      payload?.task?.description?.includes('battle');

    if (isCombatEvent && !enableCombatNarration) {
      logger.info(
        '[LocalFallbackStrategy] Combat DM narration disabled by feature flag, returning stub',
      );
      return {
        response: '',
        narrationSegments: [],
        context: payload?.agentContext,
        raw: {},
      };
    }

    // Apply cooldown for combat events
    if (isCombatEvent) {
      const now = Date.now();

      if (now - lastGlobalNarrationAt < NARRATION_COOLDOWN_MS) {
        logger.info(
          '[LocalFallbackStrategy] Combat DM narration throttled by cooldown, returning stub',
        );
        return {
          response: '',
          narrationSegments: [],
          context: payload?.agentContext,
          raw: {},
        };
      }

      lastGlobalNarrationAt = now;
    }

    logger.info('[LocalFallbackStrategy] Using local AIService for DM agent');
    const safePayload = payload ?? {};
    const { task, agentContext } = safePayload;

    const context = {
      campaignId: agentContext?.campaignDetails?.id || '',
      characterId: agentContext?.characterDetails?.id || '',
      sessionId: '',
      campaignDetails: agentContext?.campaignDetails,
      characterDetails: agentContext?.characterDetails,
    };

    const result = await AIService.chatWithDM({
      message: task?.description || '',
      context,
      conversationHistory: [],
    });

    return {
      response: result.text,
      narrationSegments: result.narrationSegments,
      context: agentContext,
      raw: {},
    };
  }

  private async executeRulesInterpreter() {
    logger.info('[LocalFallbackStrategy] Using simplified rules validation');
    return {
      isValid: true,
      suggestions: [],
      errors: [],
      explanation: 'Local rules validation - action appears valid',
    };
  }
}
