/**
 * Combat AI Integration Hook
 *
 * Bridges combat system with AI agents for seamless D&D experience.
 * Handles combat event notifications, AI responses, dice rolls, and rule validations.
 * Provides combat event notifications, dice rolls, and rule validations.
 */

import { useCallback } from 'react';

import type { CombatEvent, CombatEncounter } from '@/types/combat';
import type { CombatMessageData } from '@/utils/combat/ai-narration-utils';
import type { DetectedCombatAction } from '@/utils/combatDetection';

import { useCombat } from '@/contexts/CombatContext';
import { useCombatDetection } from '@/hooks/combat/use-combat-detection';

// Re-export types and constants for backward compatibility
export type { CombatMessageData };
export { combatActionPrompts } from '@/utils/combat/ai-narration-utils';

interface CombatAIIntegrationProps {
  sessionId?: string;
  characterId?: string;
  campaignId?: string;
}

export interface UseCombatAIIntegrationReturn {
  processCombatEvent: (event: CombatEvent) => Promise<void>;
  createCombatActionRoll: (action: DetectedCombatAction) => Promise<CombatMessageData | null>;
  isInCombat: boolean;
  encounter: CombatEncounter | null;
}

export const useCombatAIIntegration = (
  _props: CombatAIIntegrationProps,
): UseCombatAIIntegrationReturn => {
  const combatContext = useCombat();

  if (!combatContext) {
    throw new Error('useCombatAIIntegration must be used within CombatProvider');
  }

  const { state } = combatContext;

  const { createCombatActionRoll } = useCombatDetection();

  // Kept as a compatibility no-op while the retired combat-event narration path is removed.
  const processCombatEvent = useCallback(async (_event: CombatEvent) => undefined, []);

  return {
    processCombatEvent,
    createCombatActionRoll,
    isInCombat: state.isInCombat,
    encounter: state.activeEncounter,
  };
};
