import { ContextBuilderPrompts } from './context-builder-prompts';

import type { Memory } from '../memory-manager';
import type { SessionVoiceContext } from '../voice-consistency-service';
import type { GameContext, ChatMessage } from './shared/types';
import type { CombatDetectionResult } from '@/utils/combatDetection';

export class ContextBuilder {
  static async build(params: {
    context: GameContext;
    message: string;
    conversationHistory?: ChatMessage[];
    relevantMemories: Memory[];
    combatDetection: CombatDetectionResult;
    voiceContext?: SessionVoiceContext | null;
    isFirstMessage?: boolean;
  }): Promise<string> {
    const { context, combatDetection, voiceContext, isFirstMessage, relevantMemories } = params;

    let contextPrompt = ContextBuilderPrompts.buildPersonaSection();
    contextPrompt += ContextBuilderPrompts.buildRulesOfPlaySection();
    contextPrompt += await ContextBuilderPrompts.buildGameContextSection(context, relevantMemories);

    if (isFirstMessage) {
      contextPrompt += ContextBuilderPrompts.buildOpeningSceneSection();
    }

    if (combatDetection) {
      contextPrompt += ContextBuilderPrompts.formatCombatContext(combatDetection);
      if (combatDetection.isCombat) {
        contextPrompt += ContextBuilderPrompts.buildCombatRollRequirementsSection();
      }
    }

    if (voiceContext && !isFirstMessage) {
      contextPrompt += ContextBuilderPrompts.buildVoiceOptimizationSection();
    }

    contextPrompt += ContextBuilderPrompts.buildResponseStructureSection();

    if (voiceContext && !isFirstMessage) {
      contextPrompt += `\n**REMEMBER: Always respond in the JSON format with narration_segments for voice synthesis!**`;
    }

    contextPrompt += ContextBuilderPrompts.buildFinalRemindersSection();

    return contextPrompt;
  }
}