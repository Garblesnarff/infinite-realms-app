import { ContextBuilderPrompts } from './context-builder-prompts';
import { CombatRulesPrompts } from './prompts/combat-rules-prompts';
import { RulesPrompts } from './prompts/rules-prompts';

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
    contextPrompt += await ContextBuilderPrompts.buildGameContextSection(context, relevantMemories);

    if (isFirstMessage) {
      contextPrompt += ContextBuilderPrompts.buildOpeningSceneSection();
      contextPrompt += ContextBuilderPrompts.buildOpeningResponseStructureSection();
      contextPrompt += ContextBuilderPrompts.buildOpeningFinalRemindersSection();
      return contextPrompt;
    }

    contextPrompt += RulesPrompts.buildRulesOfPlaySection();

    if (combatDetection) {
      contextPrompt += CombatRulesPrompts.formatCombatContext(combatDetection);
      if (combatDetection.isCombat) {
        contextPrompt += CombatRulesPrompts.buildCombatRollRequirementsSection();
      }
    }

    if (voiceContext) {
      contextPrompt += ContextBuilderPrompts.buildVoiceOptimizationSection();
    }

    contextPrompt += ContextBuilderPrompts.buildResponseStructureSection();

    if (voiceContext) {
      contextPrompt += `\n**REMEMBER: Always respond in the JSON format with narration_segments for voice synthesis!**`;
    }

    contextPrompt += ContextBuilderPrompts.buildFinalRemindersSection();

    return contextPrompt;
  }
}
