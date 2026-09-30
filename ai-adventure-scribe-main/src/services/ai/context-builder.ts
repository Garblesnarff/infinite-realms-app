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
    combatDetection?: CombatDetectionResult;
    voiceContext?: SessionVoiceContext | null;
    isFirstMessage?: boolean;
  }): Promise<string> {
    const { context, combatDetection, voiceContext, isFirstMessage, relevantMemories } = params;

    let contextPrompt = ContextBuilderPrompts.buildPersonaSection();
    contextPrompt += await ContextBuilderPrompts.buildGameContextSection(context, relevantMemories);

    if (isFirstMessage) {
      if (context.previousSessionRecap) {
        contextPrompt += ContextBuilderPrompts.buildPreviousSessionRecapSection(
          context.previousSessionRecap,
        );
      }
      contextPrompt += ContextBuilderPrompts.buildOpeningSceneSection();
      contextPrompt += ContextBuilderPrompts.buildOpeningResponseStructureSection();
      contextPrompt += ContextBuilderPrompts.buildOpeningFinalRemindersSection();
      return contextPrompt;
    }

    // While combat is active the engine resolves attacks, spells and saves and the client drops
    // every DM roll_request (#2385), so every section sent then is its combat variant (#2400).
    const inCombat = combatDetection?.isCombat === true;
    contextPrompt += RulesPrompts.buildRulesOfPlaySection({ inCombat });

    if (combatDetection) {
      contextPrompt += CombatRulesPrompts.formatCombatContext(combatDetection);
      if (combatDetection.isCombat) {
        contextPrompt += CombatRulesPrompts.buildCombatRollRequirementsSection();
        contextPrompt += CombatRulesPrompts.buildSpatialTurnContractSection();
      }
    }

    if (voiceContext) {
      contextPrompt += ContextBuilderPrompts.buildVoiceOptimizationSection();
    }

    contextPrompt += ContextBuilderPrompts.buildResponseStructureSection({ inCombat });

    if (voiceContext) {
      contextPrompt += `\n**REMEMBER: Always respond in the JSON format with narration_segments for voice synthesis!**`;
    }

    contextPrompt += ContextBuilderPrompts.buildFinalRemindersSection({ inCombat });

    return contextPrompt;
  }
}
