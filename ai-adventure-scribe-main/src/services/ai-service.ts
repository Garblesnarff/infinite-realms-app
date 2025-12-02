import { supabase } from '@/integrations/supabase/client';
import { GEMINI_TEXT_MODEL } from '@/config/ai';
import { getGeminiApiManager, type GeminiApiManager } from '@/infrastructure/ai';
import { MemoryManager, MemoryContext } from './memory-manager';
import type { Memory } from './memory-manager';
import { WorldBuilderService } from './world-builders/world-builder-service';
import { voiceConsistencyService } from './voice-consistency-service';
import type { SessionVoiceContext } from './voice-consistency-service';
import {
  detectCombatFromText,
  type CombatDetectionResult,
  type DetectedEnemy,
  type DetectedCombatAction,
} from '@/utils/combatDetection';
import logger from '@/lib/logger';
import { generateCampaignDescription } from './ai/campaign-generator';
import { generateOpeningMessage } from './ai/opening-message-generator';
import { SessionStateService } from './session-state-service';
import { AgentOrchestrator } from './crewai/agent-orchestrator';
import type { RollRequest } from '@/components/game/DiceRollRequest';
import { PassiveSkillsService, getCharacterPassiveScores } from './passive-skills-service';
import type { Character } from '@/types/character';
// Lazy import for LangGraph to avoid loading dependencies when feature is disabled
// import { getLegacyCompatibilityAdapter } from '@/agents/langgraph/adapters/legacy-compatibility';
// import type { LegacyChatMessage } from '@/agents/langgraph/adapters/legacy-compatibility';
import migrationMonitoringService from './migration-monitoring';

// Type-only import for LegacyChatMessage (doesn't load the module)
type LegacyChatMessage = {
  id: string;
  role: string;
  content: string;
  timestamp: Date;
  narrationSegments?: any[];
};

// In-flight request deduplication with 2s TTL
const inFlight = new Map<string, { ts: number; promise: Promise<any> }>();
const DEDUPE_MS = 2000;

const PAYMENT_REQUIRED_PATTERN = /402|payment required/i;

type FallbackRollRequest = RollRequest & {
  skill?: string;
  ability?: string;
};

const ROLL_KEYWORDS: Array<{
  keywords: string[];
  build: () => FallbackRollRequest;
}> = [
  // Combat - Attack rolls
  {
    keywords: ['attack', 'strike', 'swing', 'slash', 'stab', 'shoot', 'fire', 'charge', 'snipe', 'punch', 'kick', 'hit', 'fight'],
    build: () => ({
      type: 'attack',
      formula: '1d20+attack_bonus',
      purpose: 'Attack roll to resolve your strike',
      ac: 13,
    }),
  },
  // Stealth (DEX) - expanded synonyms and phrases
  {
    keywords: ['stealth', 'sneak', 'hide', 'creep', 'quietly', 'silently', 'slip past', 'avoid detection', 'stay hidden', 'move unseen', 'shadows', 'unnoticed'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+dexterity_mod',
      purpose: 'Stealth check to stay hidden',
      dc: 14,
      skill: 'stealth',
      ability: 'dexterity',
    }),
  },
  // Deception (CHA) - NEW
  {
    keywords: ['deceive', 'lie', 'bluff', 'mislead', 'disguise', 'pretend', 'fake', 'trick', 'fool', 'con'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+charisma_mod',
      purpose: 'Deception check to mislead your target',
      dc: 15,
      skill: 'deception',
      ability: 'charisma',
    }),
  },
  // Persuasion (CHA) - expanded
  {
    keywords: ['persuade', 'convince', 'charm', 'negotiate', 'diplomacy', 'bargain', 'plead', 'appeal', 'sway', 'win over', 'reason with'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+charisma_mod',
      purpose: 'Persuasion check to influence the NPC',
      dc: 15,
      skill: 'persuasion',
      ability: 'charisma',
    }),
  },
  // Intimidation (CHA) - expanded
  {
    keywords: ['intimidate', 'threaten', 'menace', 'coerce', 'scare', 'frighten', 'bully', 'pressure', 'interrogate'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+charisma_mod',
      purpose: 'Intimidation check to cow your target',
      dc: 15,
      skill: 'intimidation',
      ability: 'charisma',
    }),
  },
  // Investigation (INT) - expanded
  {
    keywords: ['investigate', 'inspect', 'search', 'study', 'analyze', 'deduce', 'examine closely', 'find clues', 'look for'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'Investigation check to uncover details',
      dc: 14,
      skill: 'investigation',
      ability: 'intelligence',
    }),
  },
  // Acrobatics (DEX) - expanded
  {
    keywords: ['acrobatic', 'flip', 'tumble', 'dodge', 'leap', 'balance', 'cartwheel', 'somersault', 'tight-rope', 'nimble'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+dexterity_mod',
      purpose: 'Acrobatics check to keep your footing',
      dc: 13,
      skill: 'acrobatics',
      ability: 'dexterity',
    }),
  },
  // Athletics (STR) - expanded
  {
    keywords: ['climb', 'heave', 'lift', 'push', 'force', 'shove', 'grapple', 'swim', 'jump', 'sprint', 'wrestle', 'break down'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+strength_mod',
      purpose: 'Athletics check to power through the challenge',
      dc: 15,
      skill: 'athletics',
      ability: 'strength',
    }),
  },
  // Perception (WIS) - expanded
  {
    keywords: ['perceive', 'spot', 'notice', 'scan', 'watch', 'listen', 'hear', 'look around', 'keep an eye', 'on guard', 'aware'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Perception check to notice hidden details',
      dc: 13,
      skill: 'perception',
      ability: 'wisdom',
    }),
  },
  // Insight (WIS) - expanded
  {
    keywords: ['insight', 'sense motive', 'judge', 'read', 'tell if', 'detect lies', 'trustworthy', 'honest', 'true intentions'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Insight check to read intentions',
      dc: 13,
      skill: 'insight',
      ability: 'wisdom',
    }),
  },
  // Sleight of Hand (DEX) - NEW
  {
    keywords: ['pickpocket', 'palm', 'steal', 'swipe', 'pilfer', 'sleight of hand', 'conceal', 'plant'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+dexterity_mod',
      purpose: 'Sleight of Hand check',
      dc: 14,
      skill: 'sleight_of_hand',
      ability: 'dexterity',
    }),
  },
  // Survival (WIS) - NEW
  {
    keywords: ['track', 'forage', 'survive', 'hunt', 'follow trail', 'navigate', 'find path', 'wilderness'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Survival check',
      dc: 13,
      skill: 'survival',
      ability: 'wisdom',
    }),
  },
  // Medicine (WIS) - NEW
  {
    keywords: ['heal', 'stabilize', 'treat wound', 'diagnose', 'first aid', 'medicine', 'bandage'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Medicine check',
      dc: 10,
      skill: 'medicine',
      ability: 'wisdom',
    }),
  },
  // Animal Handling (WIS) - NEW
  {
    keywords: ['calm animal', 'tame', 'ride', 'control mount', 'animal handling', 'soothe beast'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+wisdom_mod',
      purpose: 'Animal Handling check',
      dc: 13,
      skill: 'animal_handling',
      ability: 'wisdom',
    }),
  },
  // Performance (CHA) - NEW
  {
    keywords: ['perform', 'sing', 'dance', 'act', 'play music', 'entertain', 'distract with'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+charisma_mod',
      purpose: 'Performance check',
      dc: 12,
      skill: 'performance',
      ability: 'charisma',
    }),
  },
  // Arcana (INT) - NEW
  {
    keywords: ['arcana', 'identify spell', 'magical knowledge', 'recognize magic', 'recall arcane'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'Arcana check to recall magical knowledge',
      dc: 15,
      skill: 'arcana',
      ability: 'intelligence',
    }),
  },
  // History (INT) - NEW
  {
    keywords: ['history', 'recall', 'remember', 'know about', 'heard of', 'historical'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'History check to recall knowledge',
      dc: 13,
      skill: 'history',
      ability: 'intelligence',
    }),
  },
  // Nature (INT) - NEW
  {
    keywords: ['nature', 'identify plant', 'identify creature', 'natural knowledge', 'recognize beast'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'Nature check',
      dc: 13,
      skill: 'nature',
      ability: 'intelligence',
    }),
  },
  // Religion (INT) - NEW
  {
    keywords: ['religion', 'divine knowledge', 'recognize deity', 'holy', 'unholy', 'undead lore'],
    build: () => ({
      type: 'skill_check',
      formula: '1d20+intelligence_mod',
      purpose: 'Religion check',
      dc: 13,
      skill: 'religion',
      ability: 'intelligence',
    }),
  },
];

function isPaymentRequiredError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  const status = (error as any)?.status ?? (error as any)?.response?.status;
  if (status === 402) {
    return true;
  }

  const message = (error as any)?.message ?? (error as any)?.response?.data?.error ?? '';
  return typeof message === 'string' && PAYMENT_REQUIRED_PATTERN.test(message);
}

function determineFallbackRoll(
  playerText: string,
  combatDetection: CombatDetectionResult,
): FallbackRollRequest | null {
  if (!playerText) {
    return combatDetection.isCombat
      ? {
          type: 'attack',
          formula: '1d20+attack_bonus',
          purpose: 'Attack roll as combat breaks out',
          ac: 13,
        }
      : null;
  }

  const lower = playerText.toLowerCase();
  for (const mapping of ROLL_KEYWORDS) {
    if (mapping.keywords.some((keyword) => lower.includes(keyword))) {
      return mapping.build();
    }
  }

  if (combatDetection.isCombat) {
    return {
      type: 'attack',
      formula: '1d20+attack_bonus',
      purpose: 'Attack roll to press the fight',
      ac: 13,
    };
  }

  return null;
}

function formatRollInstruction(roll: FallbackRollRequest): string {
  const base = `Please roll ${roll.formula} for ${roll.purpose}`;
  const target = roll.dc ? ` (DC ${roll.dc})` : roll.ac ? ` (AC ${roll.ac})` : '';
  const adv = roll.advantage ? ' with advantage' : roll.disadvantage ? ' with disadvantage' : '';
  return `${base}${target}${adv}.`;
}

function serializeRollForBlock(roll: FallbackRollRequest) {
  const payload: Record<string, unknown> = {
    type: roll.type,
    formula: roll.formula,
    purpose: roll.purpose,
  };

  if (roll.dc !== undefined) payload.dc = roll.dc;
  if (roll.ac !== undefined) payload.ac = roll.ac;
  if (roll.advantage !== undefined) payload.advantage = roll.advantage;
  if (roll.disadvantage !== undefined) payload.disadvantage = roll.disadvantage;
  if (roll.skill) payload.skill = roll.skill;
  if (roll.ability) payload.ability = roll.ability;

  return payload;
}

function buildPaymentRequiredFallback(playerText: string, combatDetection: CombatDetectionResult) {
  const roll = determineFallbackRoll(playerText, combatDetection);
  const narration = `The Dungeon Master pauses for a heartbeat, collecting their thoughts before continuing the scene.`;
  const tension = combatDetection.isCombat
    ? `Steel clashes in your imagination as the unresolved action hangs in the air.`
    : `The world around you seems to hold its breath, waiting for your next move.`;
  const rollLine = roll
    ? formatRollInstruction(roll)
    : `No roll is required yet—choose your approach.`;

  const options = [
    'A. **Stay the course**, following through exactly as you intended.',
    'B. **Adjust your tactics**, taking a more cautious, observant approach.',
    'C. **Try something unexpected**, improvising a bold alternative.',
  ];

  const rollsBlock = `\n\n\`\`\`ROLL_REQUESTS_V1\n${JSON.stringify({ rolls: roll ? [serializeRollForBlock(roll)] : [] }, null, 2)}\n\`\`\`\n`;

  const normalizedRoll: RollRequest | null = roll
    ? {
        type: roll.type,
        formula: roll.formula,
        purpose: roll.purpose,
        dc: roll.dc,
        ac: roll.ac,
        advantage: roll.advantage,
        disadvantage: roll.disadvantage,
      }
    : null;

  return {
    text: `${narration}\n\n${tension}\n${rollLine}\n\n${options.join('\n')}${rollsBlock}`,
    roll_requests: normalizedRoll ? [normalizedRoll] : [],
  };
}

function keyFor(sessionId: string | undefined, message: string, historyLen: number) {
  return `${sessionId || 'nosession'}|${message.slice(0, 256)}|${historyLen}`;
}

/**
 * Parse XML tags from DM response for memories and world updates
 * This allows single-call extraction instead of separate API calls
 */
interface ParsedXMLTags {
  narrative: string;
  memories: string[];
  worldUpdates: {
    npcs: Array<{ name: string; description: string; location: string }>;
    locations: Array<{ name: string; description: string; status: string }>;
    quests: Array<{ name: string; update: string }>;
  };
  hadTags: boolean;
}

function parseXMLTagsFromResponse(rawResponse: string): ParsedXMLTags {
  // Extract narrative (everything before XML tags)
  let narrative = rawResponse
    .replace(/<memories>[\s\S]*?<\/memories>/gi, '')
    .replace(/<world_updates>[\s\S]*?<\/world_updates>/gi, '')
    .trim();

  // Extract memories
  const memoriesMatch = rawResponse.match(/<memories>([\s\S]*?)<\/memories>/i);
  const memories = memoriesMatch
    ? memoriesMatch[1]
        .split('\n')
        .map((line) => line.replace(/^-\s*/, '').trim())
        .filter((line) => line.length > 0)
    : [];

  // Extract world updates
  const worldMatch = rawResponse.match(/<world_updates>([\s\S]*?)<\/world_updates>/i);
  const worldUpdates: ParsedXMLTags['worldUpdates'] = {
    npcs: [],
    locations: [],
    quests: [],
  };

  if (worldMatch) {
    const lines = worldMatch[1].split('\n').filter((line) => line.trim().length > 0);
    for (const line of lines) {
      const trimmed = line.replace(/^-\s*/, '').trim();

      // Parse NPC: "npc: Name | Description | Location"
      const npcMatch = trimmed.match(/^npc:\s*([^|]+)\|([^|]+)\|(.+)$/i);
      if (npcMatch) {
        worldUpdates.npcs.push({
          name: npcMatch[1].trim(),
          description: npcMatch[2].trim(),
          location: npcMatch[3].trim(),
        });
        continue;
      }

      // Parse Location: "location: Name | Description | Status"
      const locMatch = trimmed.match(/^location:\s*([^|]+)\|([^|]+)\|(.+)$/i);
      if (locMatch) {
        worldUpdates.locations.push({
          name: locMatch[1].trim(),
          description: locMatch[2].trim(),
          status: locMatch[3].trim(),
        });
        continue;
      }

      // Parse Quest: "quest: Name | Update"
      const questMatch = trimmed.match(/^quest:\s*([^|]+)\|(.+)$/i);
      if (questMatch) {
        worldUpdates.quests.push({
          name: questMatch[1].trim(),
          update: questMatch[2].trim(),
        });
      }
    }
  }

  return {
    narrative,
    memories,
    worldUpdates,
    hadTags: memoriesMatch !== null || worldMatch !== null,
  };
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  narrationSegments?: Array<{
    type: 'dm' | 'character' | 'transition';
    text: string;
    character?: string;
    voice_category?: string;
  }>;
}

type NarrationSegment = {
  type: 'dm' | 'character' | 'transition';
  text: string;
  character?: string;
  voice_category?: string;
};

export interface GameContext {
  campaignId: string;
  characterId: string;
  sessionId?: string;
  campaignDetails?: Record<string, unknown>;
  characterDetails?: Record<string, unknown>;
}

export class AIService {
  /**
   * Get the shared Gemini API manager instance
   */
  private static getGeminiManager(): GeminiApiManager {
    return getGeminiApiManager();
  }

  /** Feature flag to enable CrewAI orchestrator integration. */
  private static useCrewAI(): boolean {
    try {
      const raw = String((import.meta as any).env?.VITE_USE_CREWAI_DM ?? '')
        .toLowerCase()
        .trim();
      return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
    } catch {
      return false;
    }
  }

  /**
   * Feature flag to enable LangGraph migration.
   * When enabled, uses LangGraph-based agent system instead of custom messaging.
   */
  private static useLangGraph(): boolean {
    try {
      const raw = String((import.meta as any).env?.VITE_FEATURE_USE_LANGGRAPH ?? '')
        .toLowerCase()
        .trim();
      return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
    } catch {
      return false;
    }
  }
  /**
   * Generate a campaign description using AI with fallback
   * Delegates to modular campaign-generator.ts which includes verbalized sampling
   */
  static async generateCampaignDescription(params: {
    genre: string;
    difficulty: string;
    length: string;
    tone: string;
  }): Promise<string> {
    // Delegate to modular campaign generator (includes verbalized sampling)
    return generateCampaignDescription(params);
  }

  /**
   * Format combat detection context for the prompt
   */
  private static formatCombatContext(combatDetection: CombatDetectionResult): string {
    if (!combatDetection.isCombat) return '';

    let combatText = `\n\nCOMBAT CONTEXT DETECTED:
Combat Type: ${combatDetection.combatType}
Confidence: ${Math.round(combatDetection.confidence * 100)}%
Should Start Combat: ${combatDetection.shouldStartCombat ? 'YES' : 'NO'}
Should End Combat: ${combatDetection.shouldEndCombat ? 'YES' : 'NO'}`;

    // Add detected enemies
    if (combatDetection.enemies && combatDetection.enemies.length > 0) {
      combatText += `\n\nDETECTED ENEMIES:`;
      combatDetection.enemies.forEach((enemy: DetectedEnemy) => {
        combatText += `\n- ${enemy.name} (${enemy.type}, CR ${enemy.estimatedCR})
  HP: ${enemy.suggestedHP}, AC: ${enemy.suggestedAC}
  Description: ${enemy.description}`;
      });
    }

    // Add detected combat actions
    if (combatDetection.combatActions && combatDetection.combatActions.length > 0) {
      combatText += `\n\nDETECTED COMBAT ACTIONS:`;
      combatDetection.combatActions.forEach((action: DetectedCombatAction) => {
        combatText += `\n- ${action.actor} performs ${action.action}${action.target ? ` against ${action.target}` : ''}${action.weapon ? ` with ${action.weapon}` : ''}
  Roll Type: ${action.rollType}, Needs Roll: ${action.rollNeeded ? 'YES' : 'NO'}`;
      });
    }

    combatText += `\n\n**COMBAT RESPONSE REQUIREMENTS:**
When combat is detected, you MUST:
1. **REQUEST** dice rolls for player actions using ROLL_REQUESTS_V1 (DO NOT roll for the player)
2. **AUTO-EXECUTE** NPC/enemy actions by marking rolls with "autoExecute": true
3. Describe combat actions cinematically but maintain mechanical accuracy
4. Make tactical decisions for NPCs based on their intelligence and experience
5. Consider environmental factors and positioning
6. After receiving roll results, narrate the consequences dramatically

**CRITICAL COMBAT FLOW:**
- Player attacks → Request attack + damage rolls via ROLL_REQUESTS_V1, STOP after the block
- Enemy attacks → Include in ROLL_REQUESTS_V1 with "autoExecute": true, "actorName": "Enemy Name"
- DO NOT narrate outcomes before rolls are resolved
- DO NOT roll dice for the player - always request rolls`;

    return combatText;
  }

  /**
   * Simplified chat with AI DM for MVP with fallback and streaming support
   * Uses a single AI call instead of complex agent system
   * Now includes voice segmentation for multi-voice narration
   */
  static async chatWithDM(params: {
    message: string;
    context: GameContext;
    conversationHistory?: ChatMessage[];
    onStream?: (chunk: string) => void;
    userPlan?: 'free' | 'pro' | 'enterprise';
    turnCount?: number;
  }): Promise<{
    text: string;
    narrationSegments?: NarrationSegment[];
    roll_requests?: import('@/components/game/DiceRollRequest').RollRequest[];
    dice_rolls?: unknown[];
    combatDetection?: CombatDetectionResult;
  }> {
    // Decision about path (CrewAI vs Gemini) happens below

    // Dedupe in-flight chat calls (2s TTL)
    const key = keyFor(
      params.context?.sessionId,
      params.message,
      (params.conversationHistory || []).length,
    );
    const now = Date.now();
    for (const [k, v] of inFlight) if (now - v.ts > DEDUPE_MS) inFlight.delete(k);
    if (inFlight.has(key)) {
      logger.debug('[AIService] Deduping in-flight chat call:', key);
      return inFlight.get(key)!.promise;
    }

    const p = (async () => {
      try {
        // ========================================================================
        // LANGGRAPH MIGRATION PATH (Feature Flag)
        // ========================================================================
        // If LangGraph is enabled, delegate to the new system via compatibility adapter
        if (this.useLangGraph()) {
          try {
            logger.info(
              '[AIService] Using LangGraph agent system (VITE_FEATURE_USE_LANGGRAPH=true)',
            );

            // Dynamic import to avoid loading LangGraph when feature is disabled
            const { getLegacyCompatibilityAdapter } = await import(
              '@/agents/langgraph/adapters/legacy-compatibility'
            );
            const adapter = getLegacyCompatibilityAdapter();

            // Convert ChatMessage[] to LegacyChatMessage[]
            const legacyHistory: LegacyChatMessage[] = (params.conversationHistory || []).map(
              (msg) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: msg.timestamp,
                narrationSegments: msg.narrationSegments,
              }),
            );

            const result = await adapter.chatWithDM({
              message: params.message,
              context: params.context,
              conversationHistory: legacyHistory,
              onStream: params.onStream,
              userPlan: params.userPlan,
              turnCount: params.turnCount,
            });

            logger.info('[AIService] LangGraph response generated successfully');
            return result;
          } catch (langGraphError) {
            logger.error(
              '[AIService] LangGraph failed, falling back to legacy system:',
              langGraphError,
            );

            // Record fallback
            migrationMonitoringService.recordInteraction({
              system: 'langgraph',
              outcome: 'fallback',
              durationMs: 0,
              messageLength: params.message.length,
              responseLength: 0,
              errorType: langGraphError instanceof Error ? langGraphError.name : 'Unknown',
              errorMessage:
                langGraphError instanceof Error ? langGraphError.message : 'Unknown error',
              sessionId: params.context.sessionId,
              timestamp: new Date(),
            });

            // Continue to legacy path below
          }
        }

        // ========================================================================
        // LEGACY PATH (Custom Messaging + Gemini)
        // ========================================================================

        // Retrieve relevant memories to enhance context
        let relevantMemories: Memory[] = [];
        if (params.context.sessionId) {
          try {
            relevantMemories = await MemoryManager.getRelevantMemories(
              params.context.sessionId,
              params.message,
              8, // Get top 8 relevant memories
            );
            logger.info(`📚 Retrieved ${relevantMemories.length} relevant memories`);
          } catch (memoryError) {
            logger.warn('Failed to retrieve memories:', memoryError);
          }
        }

        // Get voice context for multi-voice narration
        // TEMPORARILY DISABLED for option button testing
        const voiceContext: SessionVoiceContext | null = null;
        // if (params.context.sessionId) {
        //   try {
        //     voiceContext = await voiceConsistencyService.getSessionVoiceContext(params.context.sessionId);
        //     logger.info(`🎭 Retrieved voice context for ${Object.keys(voiceContext.knownCharacters).length} known characters`);
        //   } catch (voiceError) {
        //     logger.warn('Failed to retrieve voice context:', voiceError);
        //   }
        // }

        // Detect combat from player message
        const combatDetection = detectCombatFromText(params.message);
        logger.info(
          `⚔️ Combat detection: ${combatDetection.isCombat ? 'YES' : 'NO'} (confidence: ${Math.round(combatDetection.confidence * 100)}%)`,
        );

        if (combatDetection.isCombat) {
          logger.info(`🎯 Combat details:`, {
            type: combatDetection.combatType,
            shouldStart: combatDetection.shouldStartCombat,
            shouldEnd: combatDetection.shouldEndCombat,
            enemies: combatDetection.enemies?.length || 0,
            actions: combatDetection.combatActions?.length || 0,
          });
        }

        // Optional path: delegate to CrewAI orchestrator behind feature flag
        if (this.useCrewAI() && params.context.sessionId) {
          try {
            logger.info('Using CrewAI microservice for chat...');
            const sessionState = await SessionStateService.getState(params.context.sessionId);
            const crewResult = await AgentOrchestrator.generateResponse({
              message: params.message,
              context: params.context,
              conversationHistory: params.conversationHistory || [],
              sessionState,
            });

            // If CrewAI returned placeholder text, generate final prose via Gemini but keep CrewAI roll_requests
            let finalText = crewResult.text || '';
            const isPlaceholder = finalText.trim().startsWith('[CrewAI placeholder]');
            const rollRequests = (crewResult as any).roll_requests || [];
            if (isPlaceholder) {
              // If a roll is requested, prompt the user to roll first instead of narrating outcomes
              if (Array.isArray(rollRequests) && rollRequests.length > 0) {
                const rr = rollRequests[0];
                const typeLabel =
                  rr.type === 'check'
                    ? 'Check'
                    : rr.type === 'save'
                      ? 'Saving Throw'
                      : rr.type === 'attack'
                        ? 'Attack'
                        : rr.type === 'damage'
                          ? 'Damage'
                          : 'Initiative';
                const purpose =
                  rr.purpose || (rr.type === 'check' ? 'Ability/Skill Check' : typeLabel);
                const target = rr.dc ? ` (DC ${rr.dc})` : rr.ac ? ` (AC ${rr.ac})` : '';
                const advantage = rr.advantage
                  ? ' with advantage'
                  : rr.disadvantage
                    ? ' with disadvantage'
                    : '';
                finalText = `Please roll ${purpose}${target}${advantage}.`;
              } else {
                logger.info(
                  'CrewAI returned placeholder text; generating narration via local Gemini.',
                );
                try {
                  const geminiManager = this.getGeminiManager();
                  const genAIResult = await geminiManager.executeWithRotation(async (genAI) => {
                    const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });
                    const prompt = `Respond to the player succinctly (2-3 short paragraphs) and end with 2-3 lettered options. Player said: "${params.message}"`;
                    const response = await model.generateContent(prompt);
                    const res = await response.response;
                    return res.text();
                  });
                  finalText = genAIResult || finalText;
                } catch (e) {
                  logger.warn('Gemini fallback for placeholder failed, using placeholder text:', e);
                }
              }
            }

            // Post-processing parity: memory extraction and world expansion
            if (params.context.sessionId) {
              // Graceful degradation: free tier only extracts memories every 3rd turn
              const shouldExtractMemory =
                params.userPlan === 'pro' ||
                params.userPlan === 'enterprise' ||
                !params.userPlan || // Default to extracting if plan is unknown
                (params.turnCount !== undefined && params.turnCount % 3 === 0);

              if (shouldExtractMemory) {
                try {
                  const memoryContext = {
                    sessionId: params.context.sessionId,
                    campaignId: params.context.campaignId,
                    characterId: params.context.characterId,
                    currentMessage: params.message,
                    recentMessages:
                      params.conversationHistory?.slice(-5).map((msg) => msg.content) || [],
                  };
                  const extractionResult = await MemoryManager.extractMemories(
                    memoryContext,
                    params.message,
                    finalText,
                  );
                  if (extractionResult.memories.length > 0) {
                    await MemoryManager.saveMemories(extractionResult.memories);
                    logger.info(
                      `🧠 Extracted and saved ${extractionResult.memories.length} memories (CrewAI path)`,
                    );
                  }
                } catch (memoryError) {
                  logger.warn('Memory extraction (CrewAI path) failed (non-fatal):', memoryError);
                }
              } else {
                logger.info(
                  `⏭️ Skipping memory extraction for free tier (turn ${params.turnCount}, next extraction on turn ${params.turnCount ? Math.ceil((params.turnCount + 1) / 3) * 3 : 'unknown'})`,
                );
              }

              try {
                const worldExpansion = await WorldBuilderService.respondToPlayerAction(
                  params.context.campaignId,
                  params.context.sessionId!,
                  params.context.characterId,
                  params.message,
                  finalText,
                );
                if (
                  worldExpansion &&
                  worldExpansion.locations.length +
                    worldExpansion.npcs.length +
                    worldExpansion.quests.length >
                    0
                ) {
                  logger.info(
                    `🌍 World expanded (CrewAI): +${worldExpansion.locations.length} locations, +${worldExpansion.npcs.length} NPCs, +${worldExpansion.quests.length} quests`,
                  );
                }
              } catch (worldError) {
                logger.warn('World building (CrewAI path) failed (non-fatal):', worldError);
              }
            }

            const enhancedCrewResult = {
              ...crewResult,
              text: finalText,
              combatDetection: {
                isCombat: combatDetection.isCombat,
                confidence: combatDetection.confidence,
                combatType: combatDetection.combatType,
                shouldStartCombat: combatDetection.shouldStartCombat,
                shouldEndCombat: combatDetection.shouldEndCombat,
                enemies: combatDetection.enemies || [],
                combatActions: combatDetection.combatActions || [],
              },
            } as any;

            return enhancedCrewResult;
          } catch (crewError) {
            logger.warn('CrewAI orchestrator failed, falling back to Gemini:', crewError);
            // Continue to legacy path below
          }
        }

        // Use local Gemini API
        logger.info('Using local Gemini API for chat...');
        const geminiManager = this.getGeminiManager();

        const result = await geminiManager.executeWithRotation(async (genAI) => {
          const model = genAI.getGenerativeModel({ model: GEMINI_TEXT_MODEL });

          // Build enhanced context for DM interactions with voice segmentation
          let contextPrompt = `<persona>
You are a skilled D&D 5e Dungeon Master who creates immersive, mechanically-sound adventures. You balance compelling narrative with proper game mechanics, always giving players meaningful choices with clear consequences.
</persona>`;

          contextPrompt += `<rules_of_play>

<when_to_request_rolls>
<title>CRITICAL: WHEN TO REQUEST DICE ROLLS</title>
Request a roll when the outcome is UNCERTAIN. Ask yourself:
- Can this action fail? → Request a roll
- Is there opposition or difficulty? → Request a roll
- Does success/failure meaningfully change the story? → Request a roll

<uncertain_outcomes_need_rolls>
- **Perception**: Noticing hidden things, reading situations, spotting traps
- **Stealth**: Sneaking, hiding, moving quietly, avoiding detection
- **Deception**: Lying, disguises, misdirection, bluffing
- **Persuasion**: Convincing, negotiating, charming, bargaining
- **Intimidation**: Threatening, coercing, interrogating
- **Investigation**: Searching, analyzing, deducing, finding clues
- **Insight**: Reading intentions, detecting lies, sensing motives
- **Athletics**: Climbing, jumping, swimming, grappling, forcing doors
- **Acrobatics**: Balance, tumbling, dodging, tight-rope walking
- **Sleight of Hand**: Pickpocketing, hiding objects, card tricks
- **Arcana/History/Nature/Religion**: Recalling specialized knowledge
- **Survival**: Tracking, foraging, navigation, weather prediction
- **Medicine**: Stabilizing, diagnosing, treating wounds
- **Animal Handling**: Calming, training, controlling animals
- **Performance**: Entertaining, impressing, distracting
- **ALL combat**: Attacks, damage, saves, initiative
</uncertain_outcomes_need_rolls>

<certain_outcomes_no_rolls>
- Walking down an empty corridor
- Talking to a friendly, willing NPC about general topics
- Looking at something obvious in plain sight
- Picking up an item from a table
- Opening an unlocked, untrapped door
</certain_outcomes_no_rolls>
</when_to_request_rolls>

<roll_request_format>
<title>HOW TO REQUEST ROLLS</title>
**When an action has uncertain outcome, include this code block at the END of your response:**

\`\`\`ROLL_REQUESTS_V1
{
  "rolls": [
    {
      "type": "skill_check",
      "formula": "1d20+modifier",
      "purpose": "Description of what this roll is for",
      "dc": 14
    }
  ]
}
\`\`\`

<field_requirements>
- **type**: "skill_check", "save", "attack", "damage", or "initiative"
- **formula**: Dice notation (e.g., "1d20+3", "2d6+4")
- **purpose**: Brief explanation (e.g., "Stealth check to sneak past guards")
- **dc**: Difficulty Class for checks/saves (optional)
- **ac**: Armor Class for attacks (optional)
- **advantage/disadvantage**: true if applicable (optional)
</field_requirements>

<examples>
Stealth: \`{"type": "skill_check", "formula": "1d20+dex", "purpose": "Stealth check to avoid detection", "dc": 14}\`
Persuasion: \`{"type": "skill_check", "formula": "1d20+cha", "purpose": "Persuasion to convince the merchant", "dc": 15}\`
Perception: \`{"type": "skill_check", "formula": "1d20+wis", "purpose": "Perception to notice hidden details", "dc": 12}\`
Attack: \`{"type": "attack", "formula": "1d20+5", "purpose": "Attack roll with longsword", "ac": 15}\`
Save: \`{"type": "save", "formula": "1d20+2", "purpose": "Dexterity save to dodge fireball", "dc": 15}\`
Death Save: \`{"type": "save", "formula": "1d20", "purpose": "Death saving throw", "dc": 10}\`
</examples>
</roll_request_format>

<roll_before_outcome>
<title>CRITICAL: REQUEST ROLLS BEFORE NARRATING OUTCOMES</title>
**DO NOT narrate results of uncertain actions before the player rolls!**

✅ CORRECT FLOW:
1. Player says "I try to sneak past the guards"
2. You respond with narrative setup + roll request at end
3. Player rolls
4. THEN you narrate success/failure based on their roll

❌ WRONG: "You successfully sneak past the guards..." (before they rolled!)
❌ WRONG: "You try to sneak but the guard spots you..." (before they rolled!)
✅ RIGHT: "The guards patrol the corridor ahead. Their torchlight flickers against the stone walls..." + roll request
</roll_before_outcome>

<critical_roll_stopping_rule>
**CRITICAL: YOUR RESPONSE MUST END WITH THE ROLL REQUEST**

When you request a roll, your turn is COMPLETE. You must STOP immediately after the roll request block.

DO NOT after requesting a roll:
- Narrate what happens if they succeed or fail
- Describe the outcome conditionally ("If you succeed...")
- Assume any result and continue the story
- Add any text after the ROLL_REQUESTS_V1 block

✅ CORRECT (stop after roll request):
"The ancient wall looms before you, its stones worn smooth by centuries of rain. You'll need to find handholds carefully.

\`\`\`ROLL_REQUESTS_V1
{"rolls":[{"type":"skill_check","formula":"1d20+athletics","purpose":"Athletics check to climb the wall","dc":15}]}
\`\`\`"

❌ WRONG (continues after roll request):
"The ancient wall looms before you...

\`\`\`ROLL_REQUESTS_V1
{"rolls":[...]}
\`\`\`

You manage to find purchase on the weathered stone and pull yourself up..."

The outcome narration happens in your NEXT response, AFTER you see the player's roll result.
</critical_roll_stopping_rule>

<npc_rolls>
You handle NPC/monster rolls "behind the screen":
✅ "The orc swings its greataxe (rolled 16, hits AC 13) dealing 12 slashing damage!"
✅ "The wizard mutters an incantation (you sense hostile magic forming)..."
</npc_rolls>

<dialogue>
<title>NPC DIALOGUE REQUIREMENTS</title>
ALL NPC speech MUST be in direct quotes with attribution:
✅ "What brings you to my tavern?" the barkeep asks, wiping a glass.
✅ The guard steps forward. "State your business, stranger."
❌ The barkeep asks what you want. (NO - use direct quotes!)
❌ The guard questions you suspiciously. (NO - show the actual words!)

Give NPCs distinct voices:
- Gruff dwarf: "Bah! What's a human doing in these tunnels?"
- Elegant elf: "How... unexpected to encounter your kind here."
- Nervous merchant: "P-perhaps we could... negotiate?"
</dialogue>

<combat>
<title>COMBAT GUIDELINES</title>
- Request initiative when combat begins
- Request attack rolls for player actions
- Request saving throws when effects target players
- Request damage rolls after successful hits
- Handle NPC actions behind the screen
- Use D&D 5e rules: advantage/disadvantage, conditions, cover
- Describe actions cinematically with mechanical accuracy
- Include battle cries and combat dialogue in quotes

<turn_flow>
<title>CRITICAL: COMBAT TURN ORDER</title>
**Initiative order determines who acts when. NEVER give the player multiple turns in a row!**

After Player Completes Their Turn:
1. Narrate the outcome of their action (damage dealt, effects applied)
2. **IMMEDIATELY** proceed to the next combatant in initiative order (usually an NPC/enemy)
3. **DO NOT** give the player 3 options after their turn
4. **DO NOT** ask "What do you do?" during NPC turns

NPC/Enemy Turn Flow:
1. Narrate what the NPC does: "The goblin snarls and lunges at you with its rusty dagger!"
2. Execute NPC rolls automatically with autoExecute: true
3. Narrate the outcome: "The goblin's blade strikes true! (rolled 16, hits AC 14)"
4. Apply damage/effects
5. If more NPCs have turns, continue narrating their actions
6. **ONLY** when it's the player's turn again, give them options

Example CORRECT Turn Flow:
\`\`\`
Player: "I attack the goblin with my longsword"
DM: Requests attack + damage rolls
Player: Rolls
DM: "Your blade cuts deep! The goblin staggers back, bloodied. The second goblin shrieks and charges at you!"
[Auto-executes goblin attack with autoExecute: true]
DM: "The goblin's dagger slashes across your arm! You take 5 slashing damage. It's your turn. What do you do?"
[NOW give options]
\`\`\`

Example WRONG Turn Flow (DO NOT DO THIS):
\`\`\`
Player: "I attack the goblin"
DM: Requests rolls, player completes
DM: "You hit! The goblin takes 8 damage. What do you do?"
A. Attack again
B. Defend
C. Move
[WRONG - This gives player multiple turns!]
\`\`\`

**Rule: Player gets ONE action per turn, then NPCs act, then back to player. Enforce this strictly!**
</turn_flow>

<multiple_enemies>
<title>MANAGING MULTIPLE ENEMIES</title>
When combat involves multiple enemies of the same type, track them individually:

Enemy Naming:
- Use clear identifiers: "Goblin 1", "Goblin 2", "Goblin Archer", "Hobgoblin Captain"
- Keep names consistent throughout combat
- Example: "Three bandits surround you: Bandit 1 (scarred face), Bandit 2 (crossbow), Bandit 3 (leader)"

Targeting Clarity:
- When player attacks, confirm which enemy: "You strike at Goblin 1 with your longsword"
- Track HP separately for each enemy
- Narrate damage to specific enemies: "Goblin 1 staggers, bloodied (3 HP remaining)"

Enemy Turns:
- All enemies act during "enemy turn" phase
- Execute in order: "Goblin 1 attacks (autoExecute), Goblin 2 flanks and strikes (autoExecute)"
- Describe each enemy's action distinctly
- Example: "Goblin 1's dagger misses. Goblin 2 strikes true - you take 4 damage!"

Enemy Death:
- Clearly narrate when an enemy dies: "Goblin 1 falls, lifeless"
- Remove from initiative: "Two goblins remain"
- Track remaining enemies: "Goblin 2 and Goblin 3 continue fighting"

Example Multi-Enemy Combat:
\`\`\`
DM: "Two wolves emerge from the shadows - Wolf 1 (larger, scarred) and Wolf 2 (lean, hungry)"
Player: "I attack Wolf 1"
DM: [Requests attack roll]
Player: [Rolls, hits]
DM: "Your blade strikes Wolf 1! It yelps in pain (5 HP remaining). Now the wolves attack!"
[Auto-executes Wolf 1 attack with actorName: "Wolf 1"]
[Auto-executes Wolf 2 attack with actorName: "Wolf 2"]
DM: "Wolf 1 snaps at your leg (rolled 12, miss). Wolf 2 lunges and bites your arm - 6 damage! Your turn."
\`\`\`
</multiple_enemies>

<death_saves>
<title>DEATH SAVING THROWS (0 HP)</title>
When a character reaches 0 HP, they fall unconscious and begin making death saving throws.

Death Save Rules (D&D 5e):
- Character is UNCONSCIOUS and can't take actions
- Each turn at 0 HP, roll a death save (d20, DC 10, no modifiers)
- Roll 10+: Success (mark 1 success)
- Roll 9 or less: Failure (mark 1 failure)
- Natural 20: Regain 1 HP instantly (wake up!)
- Natural 1: Count as 2 failures
- 3 Successes: Stabilized (unconscious but not dying)
- 3 Failures: Character DIES

Taking Damage at 0 HP:
- Any damage while at 0 HP = 1 automatic death save failure
- Critical hit while at 0 HP = 2 automatic death save failures

How to Handle:
1. When character reaches 0 HP: "You collapse, unconscious. The world fades to black. Make a death saving throw!"
2. Request death save: \`{"type": "save", "formula": "1d20", "purpose": "Death saving throw", "dc": 10}\`
3. Track results in narrative: "You rolled 14 - that's one success. Two more and you stabilize."
4. If stabilized: "You've stabilized! You're still unconscious at 0 HP, but no longer dying."
5. If healed while down: "The healing magic washes over you. You regain X HP and wake up!"
6. If 3 failures: "Your third death save fails... everything goes dark. [Character name] has died."

Death Save Tracking Example:
\`\`\`
Player at 0 HP (unconscious)
DM: "Make a death saving throw to cling to life!"
[Request: death_save roll]
Player: Rolls 12
DM: "One success! You're still unconscious. The goblin raises its blade..."
[Goblin turn, may attack downed player]
DM: "Make another death save!"
Player: Rolls natural 20
DM: "Your eyes snap open! You regain 1 HP and stand, battered but alive!"
\`\`\`

CRITICAL: Death is permanent in D&D. Treat it seriously. Give dramatic narration when lives hang in the balance.
</death_saves>

<healing>
<title>HEALING AND RECOVERY</title>
Healing restores hit points and can bring unconscious characters back to consciousness.

Healing Sources:
- Spells: Cure Wounds (1d8+modifier), Healing Word (1d4+modifier), Prayer of Healing (2d8+modifier)
- Potions: Potion of Healing (2d4+2), Potion of Greater Healing (4d4+4)
- Class Features: Lay on Hands (Paladin), Second Wind (Fighter)
- Short/Long Rests: Hit dice or full recovery

How to Handle Healing:
1. Player casts healing spell: Request roll for healing amount
2. Format: \`{"type": "damage", "formula": "1d8+3", "purpose": "Cure Wounds healing"}\`
3. Note: Use "damage" type for healing rolls (positive HP change)
4. Narrate: "The divine light washes over your wounds. You regain 7 hit points!"

Healing Mechanics:
- HP can't exceed maximum (cap healing at max HP)
- Healing brings unconscious characters back: "You regain 5 HP and your eyes flutter open!"
- Healing at 0 HP resets death saves to 0/0
- Healing does NOT restore temporary HP
- Healing during combat uses an action (Cure Wounds) or bonus action (Healing Word)

Self-Healing Example:
\`\`\`
Player (3 HP remaining): "I cast Cure Wounds on myself"
DM: "Roll for healing"
[Request: {"type": "damage", "formula": "1d8+3", "purpose": "Cure Wounds healing"}]
Player: Rolls 6 (total 9 healing)
DM: "Divine energy flows through you. You feel your wounds close, regaining 9 HP (now at 12/12 HP, fully healed)!"
\`\`\`

Healing Downed Ally:
\`\`\`
Ally unconscious at 0 HP (2 death save failures)
Player: "I use Healing Word on them!"
DM: "Roll healing"
Player: Rolls 3 healing
DM: "Your words of power spark life! They regain 3 HP, their eyes snap open, and they gasp for breath! (Death saves reset)"
\`\`\`

Potion Use:
- Drinking a potion is an action
- Administering to unconscious ally is an action
- Potion of Healing: 2d4+2 (avg 7 HP)
</healing>

<temporary_hp>
<title>TEMPORARY HIT POINTS</title>
Temporary HP provides a buffer of extra hit points that absorb damage before real HP.

Temp HP Rules (D&D 5e):
- Absorbed FIRST before real HP takes damage
- Does NOT stack - if you gain temp HP again, use the HIGHER value (not cumulative)
- Healing does NOT restore temp HP
- Temp HP lost when taking damage or after duration expires
- Can have temp HP even at full HP

Temp HP Sources:
- Spells: Armor of Agathys (5 temp HP per spell level), False Life (1d4+4 temp HP), Heroism (caster's spellcasting modifier temp HP each turn)
- Class Features: Fiend Warlock (temp HP when reducing enemy to 0), Inspiring Leader feat
- Magic Items: Certain potions or artifacts

How to Grant Temp HP:
1. Narrate the source: "You cast Armor of Agathys, and icy armor coats your skin."
2. State the amount: "You gain 5 temporary hit points."
3. Display in UI: Shows as blue (+5) next to HP
4. If player already has temp HP: "You have 3 temp HP. Armor of Agathys grants 5. You keep the higher value (5 temp HP)."

Temp HP in Combat Example:
\`\`\`
Player (12/12 HP): "I cast False Life"
DM: "Roll temp HP"
[Request: {"type": "damage", "formula": "1d4+4", "purpose": "False Life temporary HP"}]
Player: Rolls 7
DM: "Dark energy swirls around you. You gain 7 temporary hit points! (12 HP + 7 temp HP buffer)"

[Enemy attacks, deals 5 damage]
DM: "The goblin's blade strikes! 5 damage. Your temp HP absorbs it all - you have 2 temp HP remaining and still 12/12 HP!"

[Enemy attacks again, deals 4 damage]
DM: "Another hit! 4 damage. Your 2 temp HP is depleted, and you take 2 real damage (now at 10/12 HP, 0 temp HP)."
\`\`\`

Temp HP vs Healing:
- Temp HP 5, Real HP 10/15: Healing spell restores real HP to 15/15, temp HP stays at 5
- Temp HP doesn't count toward max HP
- Temp HP + Real HP = Total effective HP pool

Non-Stacking Example:
\`\`\`
Player has 5 temp HP from Armor of Agathys
Player: "I use Inspiring Leader feature, granting 4 temp HP"
DM: "You already have 5 temp HP. Inspiring Leader would grant 4. You keep the higher value (5 temp HP)."
\`\`\`
</temporary_hp>

<advantage_disadvantage>
<title>ADVANTAGE AND DISADVANTAGE</title>
**When rolling with advantage or disadvantage, request TWO d20 rolls and specify which to use.**

Advantage (roll twice, take HIGHER):
- Attacking a prone enemy from melee
- Attacking a blinded, paralyzed, or restrained enemy
- Attacking an enemy you're hidden from
- Attacks from allies using Help action
- Class features (Reckless Attack, etc.)

Disadvantage (roll twice, take LOWER):
- Attacking while prone
- Attacking while blinded, poisoned, or restrained
- Ranged attacks at long range
- Attacking an enemy you can't see
- Attacks in heavy obscurement

ROLL_REQUEST Example with Advantage:
\`\`\`json
{
  "type": "attack",
  "purpose": "Longsword attack with advantage (enemy is prone)",
  "diceNotation": "1d20+5",
  "count": 2,
  "modifier": 5,
  "dc": null,
  "actorName": "Aria",
  "autoExecute": false,
  "advantageType": "advantage"
}
\`\`\`

**CRITICAL: When a player has advantage/disadvantage, request 2 d20 rolls and explicitly state "take the higher/lower"**

Advantage/Disadvantage DO NOT Stack:
- Multiple sources of advantage = still just advantage (roll 2d20, take higher)
- Multiple sources of disadvantage = still just disadvantage (roll 2d20, take lower)
- If both advantage AND disadvantage exist = CANCEL OUT (roll normal 1d20)
</advantage_disadvantage>

<critical_hits>
<title>CRITICAL HITS AND FUMBLES</title>
**Natural 20 on attack roll = AUTOMATIC HIT + DOUBLE DAMAGE DICE**

Critical Hit Process:
1. Player rolls natural 20 on attack roll
2. Attack automatically hits (no need to check AC)
3. Request damage roll with DOUBLED DICE (not doubled total)
4. Example: Longsword (1d8+3) becomes 2d8+3 on crit (NOT (1d8+3)×2)

Correct Crit Damage Examples:
- Longsword (1d8+3) → **2d8+3** on crit
- Greatsword (2d6+4) → **4d6+4** on crit
- Sneak Attack (1d8+3+2d6) → **2d8+3+4d6** on crit (ALL damage dice double)
- Spell (3d6 fire) → **6d6 fire** on crit

ROLL_REQUEST for Critical Damage:
\`\`\`json
{
  "type": "damage",
  "purpose": "CRITICAL HIT - Longsword damage (doubled dice)",
  "diceNotation": "2d8+3",
  "modifier": 3,
  "actorName": "Aria",
  "autoExecute": false,
  "damageType": "slashing"
}
\`\`\`

Natural 1 (Critical Fumble):
- Automatic MISS (regardless of bonuses)
- No additional penalties unless specific house rules

**NPC Critical Hits:**
- Use "autoExecute": true and double damage dice same as players
- Narrate dramatically: "The goblin's blade finds a gap in your armor! CRITICAL HIT for [doubled damage]!"
</critical_hits>

<combat_conditions>
<title>COMBAT CONDITIONS AND STATUS EFFECTS</title>
**Track conditions that affect combat capabilities. Conditions alter rolls and abilities.**

Common Conditions:

**Blinded:**
- Attack rolls: DISADVANTAGE
- Enemy attacks against you: ADVANTAGE
- Can't see (auto-fail Perception checks requiring sight)

**Charmed:**
- Can't attack charmer
- Charmer has advantage on social checks

**Frightened:**
- Ability checks and attacks: DISADVANTAGE (while source is in sight)
- Can't willingly move closer to source

**Grappled:**
- Speed becomes 0
- Can't benefit from bonuses to speed
- Ends if grappler is incapacitated

**Incapacitated:**
- Can't take actions or reactions
- Common from being stunned, paralyzed, or unconscious

**Invisible:**
- Attack rolls: ADVANTAGE
- Enemy attacks against you: DISADVANTAGE
- Can't be seen (auto-success on Stealth)

**Paralyzed:**
- Incapacitated (can't move or speak)
- Auto-fail Strength and Dexterity saves
- Attacks against you: ADVANTAGE
- Hits from within 5ft: AUTOMATIC CRITICAL

**Poisoned:**
- Attack rolls: DISADVANTAGE
- Ability checks: DISADVANTAGE

**Prone:**
- Attack rolls: DISADVANTAGE
- Enemy melee attacks against you: ADVANTAGE
- Enemy ranged attacks against you: DISADVANTAGE
- Costs half movement to stand up

**Restrained:**
- Speed becomes 0
- Attack rolls: DISADVANTAGE
- Attacks against you: ADVANTAGE
- Dexterity saves: DISADVANTAGE

**Stunned:**
- Incapacitated (can't move)
- Auto-fail Strength and Dexterity saves
- Attacks against you: ADVANTAGE

**Unconscious:**
- Incapacitated, can't move or speak
- Drops everything held
- Auto-fail Strength and Dexterity saves
- Attacks against you: ADVANTAGE
- Hits from within 5ft: AUTOMATIC CRITICAL
- Unaware of surroundings

Tracking Conditions:
\`\`\`
DM: "The goblin shaman casts Hold Person. Make a Wisdom saving throw!"
[Player rolls, fails]
DM: "You're PARALYZED! You can't move or take actions. Attacks against you have advantage, and any hit from within 5 feet is an automatic critical. You can retry the save at the end of your turn."
\`\`\`

**Condition Duration:**
- Some end after 1 minute (10 rounds)
- Some require saves at end of turn
- Some last until dispelled or rested
- Always specify duration and save conditions
</combat_conditions>

<action_economy>
<title>ACTION ECONOMY IN COMBAT</title>
**Each turn, a character gets: 1 ACTION + 1 BONUS ACTION + 1 REACTION + MOVEMENT**

ACTION (choose ONE per turn):
- Attack (one weapon attack, or multiple if character has Extra Attack)
- Cast a Spell (with casting time of 1 action)
- Dash (double movement)
- Disengage (move without provoking opportunity attacks)
- Dodge (attacks against you have disadvantage until next turn)
- Help (give ally advantage on next ability check or attack)
- Hide (make Stealth check)
- Ready (prepare action for specific trigger)
- Use Object (interact with object/environment)
- Search (make Perception/Investigation check)

BONUS ACTION:
- NOT automatic - only if class feature, spell, or ability grants it
- Examples: Two-Weapon Fighting, Cunning Action (rogue), bonus action spells
- **CRITICAL: Can't use bonus action unless something specifically grants it**

Example Bonus Actions:
- Rogue: Cunning Action (Dash, Disengage, or Hide as bonus action)
- Barbarian: Rage (enter rage as bonus action)
- Fighter: Second Wind (heal as bonus action)
- Monk: Flurry of Blows, Patient Defense, Step of the Wind
- Spell: Healing Word, Spiritual Weapon, Misty Step

REACTION (1 per round, triggers on someone else's turn):
- Opportunity Attack (when enemy leaves your reach)
- Spells like Shield, Counterspell, Absorb Elements
- Class features like Riposte, Parry, Uncanny Dodge
- **CRITICAL: Resets at START of your turn, not end of round**

MOVEMENT:
- Can move up to your speed (usually 30ft)
- Can split movement (move 10ft, attack, move 20ft more)
- Difficult terrain costs 2ft per 1ft moved
- Standing from prone costs HALF your movement

Example Turn:
\`\`\`
Player: "I move 20 feet toward the goblin, attack with my longsword, then move 10 feet behind the pillar for cover."
DM: "Perfect! That's your movement split around your action. Roll to attack!"
[Player hits]
DM: "Since you're a rogue, you can use your BONUS ACTION for Cunning Action. Want to Hide behind that pillar?"
Player: "Yes!"
DM: "Make a Stealth check as your bonus action."
\`\`\`

TWO-WEAPON FIGHTING:
- Action: Attack with light weapon in main hand
- Bonus Action: Attack with light weapon in off-hand (NO ABILITY MODIFIER to damage unless you have Two-Weapon Fighting style)
- Example: "Attack with shortsword (1d6+3), then bonus action attack with dagger (1d4, no modifier)"

**CRITICAL RULES:**
1. Players can ONLY use bonus action if they have a feature that grants it
2. Reactions reset at the START of their turn, usable once per round
3. Movement can be split before/after actions
4. Can't take two actions - no "I attack twice with my action" unless Extra Attack feature
5. Bonus action spell + action spell = ONLY if one is a cantrip (PHB spellcasting rules)

Casting Time Restrictions:
- Bonus action spell (like Healing Word) means action can ONLY be a cantrip
- Action spell means no bonus action spell (unless bonus action is non-spell like Cunning Action)
- Example: Can't cast Fireball (action) + Misty Step (bonus action) in same turn
</action_economy>

</combat>

<encounter_difficulty>
<title>CRITICAL: ENCOUNTER SCALING BY CHARACTER LEVEL</title>
**ALWAYS match enemy difficulty to character level to prevent instant death!**

Character Level 1-2 (8-20 HP):
- Use CR 1/8 to CR 1/2 enemies ONLY (goblins, kobolds, bandits, wolves)
- Max enemy damage: 1d6+2 (avg 5 damage)
- Example enemies: Goblin (7 HP, +4 to hit, 1d6+2 damage), Wolf (11 HP, +4 to hit, 2d4+2 damage)
- Deadly encounter: 2-3 CR 1/4 enemies or 1 CR 1/2 enemy

Character Level 3-4 (20-35 HP):
- Use CR 1/2 to CR 2 enemies (orcs, hobgoblins, ogres, werewolves)
- Max enemy damage: 2d6+3 (avg 10 damage)
- Example enemies: Orc (15 HP, +5 to hit, 1d12+3 damage), Hobgoblin (11 HP, +3 to hit, 1d8+1 damage)

Character Level 5-8 (35-60 HP):
- Use CR 2 to CR 5 enemies (young dragons, elementals, trolls)
- Max enemy damage: 2d10+4 (avg 15 damage)

Character Level 9+ (60+ HP):
- Use CR 5+ enemies (adult dragons, giants, liches)
- Can use higher damage (3d10+, 4d8+, etc.)

**CRITICAL RULES:**
1. NEVER use enemies with damage that exceeds 50% of character's max HP in one hit
2. Level 1 characters (8-12 HP) should NEVER face enemies dealing 10+ damage
3. Always check character level before introducing combat
4. For solo adventurers: use 1-2 enemies max, scaled DOWN one difficulty tier
5. If unsure, err on the side of easier encounters - TPK (Total Party Kill) ruins the game!

**Damage Guidelines by Level:**
- Level 1: Max 6 damage per hit (1d6+2 or 1d8+1)
- Level 2: Max 8 damage per hit (1d8+3 or 2d4+2)
- Level 3-4: Max 10 damage per hit (1d12+3 or 2d6+3)
- Level 5+: Scale proportionally to character HP pool
</encounter_difficulty>

</rules_of_play>`;

          contextPrompt += `<game_context>`;
          if (params.context.campaignDetails) {
            contextPrompt += `<campaign_details>
CAMPAIGN: "${params.context.campaignDetails.name}"
DESCRIPTION: ${params.context.campaignDetails.description}
</campaign_details>`;
          }

          if (params.context.characterDetails) {
            const char = params.context.characterDetails;
            contextPrompt += `<character_details>
PLAYER CHARACTER: ${char.name}, a level ${char.level} ${char.race || 'Unknown Race'} ${char.class || 'Unknown Class'}`;
            if (char.background) {
              contextPrompt += ` (${char.background} background)`;
            }

            // Add character stats for roll calculations
            if (char.character_stats && char.character_stats.length > 0) {
              const stats = char.character_stats[0];
              contextPrompt += `
<ability_scores>
STR ${stats.strength}(${Math.floor((stats.strength - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.strength - 10) / 2)}), DEX ${stats.dexterity}(${Math.floor((stats.dexterity - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.dexterity - 10) / 2)}), CON ${stats.constitution}(${Math.floor((stats.constitution - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.constitution - 10) / 2)}), INT ${stats.intelligence}(${Math.floor((stats.intelligence - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.intelligence - 10) / 2)}), WIS ${stats.wisdom}(${Math.floor((stats.wisdom - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.wisdom - 10) / 2)}), CHA ${stats.charisma}(${Math.floor((stats.charisma - 10) / 2) >= 0 ? '+' : ''}${Math.floor((stats.charisma - 10) / 2)})
</ability_scores>`;

              // Calculate and include proficiency bonus
              const profBonus =
                char.level >= 17
                  ? 6
                  : char.level >= 13
                    ? 5
                    : char.level >= 9
                      ? 4
                      : char.level >= 5
                        ? 3
                        : 2;
              contextPrompt += `
<proficiency_bonus>+${profBonus}</proficiency_bonus>`;
            }

            // Add default equipment for class-based damage rolls
            const classEquipment = this.getClassEquipment(
              char.class?.name || char.class || 'Fighter',
            );
            contextPrompt += `
<equipment>
${classEquipment.weapons.join(', ')} | ${classEquipment.armor}
**CRITICAL: USE EXACT WEAPON DICE from equipment list above for damage roll requests!**
</equipment>`;

            // Add passive skills for automatic scene awareness
            try {
              // Convert the character data to match Character interface
              const characterForPassive: Character = {
                id: char.id,
                name: char.name,
                level: char.level,
                abilityScores: char.character_stats?.[0]
                  ? {
                      strength: {
                        score: char.character_stats[0].strength || 10,
                        modifier: Math.floor((char.character_stats[0].strength || 10 - 10) / 2),
                        savingThrow: false,
                      },
                      dexterity: {
                        score: char.character_stats[0].dexterity || 10,
                        modifier: Math.floor((char.character_stats[0].dexterity || 10 - 10) / 2),
                        savingThrow: false,
                      },
                      constitution: {
                        score: char.character_stats[0].constitution || 10,
                        modifier: Math.floor((char.character_stats[0].constitution || 10 - 10) / 2),
                        savingThrow: false,
                      },
                      intelligence: {
                        score: char.character_stats[0].intelligence || 10,
                        modifier: Math.floor((char.character_stats[0].intelligence || 10 - 10) / 2),
                        savingThrow: false,
                      },
                      wisdom: {
                        score: char.character_stats[0].wisdom || 10,
                        modifier: Math.floor((char.character_stats[0].wisdom || 10 - 10) / 2),
                        savingThrow: false,
                      },
                      charisma: {
                        score: char.character_stats[0].charisma || 10,
                        modifier: Math.floor((char.character_stats[0].charisma || 10 - 10) / 2),
                        savingThrow: false,
                      },
                    }
                  : undefined,
                skillProficiencies: char.skill_proficiencies?.split(',').map((s) => s.trim()) || [],
              };
              const passiveScores = getCharacterPassiveScores(characterForPassive);
              contextPrompt += `

<passive_skills>
**D&D 5E PASSIVE SKILLS (Automatic Checks)**
Passive Perception: ${passiveScores.perception} (notices hidden objects, creatures, traps without rolling)
Passive Insight: ${passiveScores.insight} (senses deception, motives, emotional states automatically)
Passive Investigation: ${passiveScores.investigation} (spots clues, patterns, logical inconsistencies passively)

**DM GUIDANCE: Use these passive scores to proactively reveal information:**
- If a scene has hidden elements with DC ≤ passive score, reveal them automatically
- Example: "Your keen awareness (Passive Perception ${passiveScores.perception}) notices subtle scuff marks on the floor"
- Example: "Something about their story doesn't add up (Passive Insight ${passiveScores.insight})"
- Example: "The patterns in the dust suggest recent activity (Passive Investigation ${passiveScores.investigation})"
- Use passive checks for things the character would naturally notice without actively searching
- Reserve active checks (d20 rolls) for deliberate investigation or difficult perception tasks
</passive_skills>`;
            } catch (passiveSkillError) {
              logger.warn('Failed to calculate passive skills (non-fatal):', passiveSkillError);
            }

            contextPrompt += `
</character_details>`;
          }

          // Add relevant memories to context
          if (relevantMemories.length > 0) {
            contextPrompt += `
<story_memories>
<title>IMPORTANT STORY MEMORIES</title>
Reference these memories naturally to maintain story continuity.`;
            relevantMemories.forEach((memory, index) => {
              contextPrompt += `
<memory index="${index + 1}" type="${memory.type.toUpperCase()}">${memory.content}</memory>`;
            });
            contextPrompt += `
</story_memories>`;
          }
          contextPrompt += `</game_context>`;

          // Detect if this is a campaign opening (first message)
          const isFirstMessage =
            (!params.conversationHistory || params.conversationHistory.length === 0) &&
            (!params.message || params.message.trim() === '');

          if (isFirstMessage) {
            contextPrompt += `<opening_scene_requirements>
<title>CAMPAIGN OPENING - FIRST MESSAGE REQUIREMENTS</title>
This is the campaign's opening scene. Create an engaging D&D adventure start that hooks the player immediately.

<structure>
1. **Scene Setting**: Establish location, atmosphere, and immediate situation using rich sensory details.
2. **Character Integration**: Connect the character's background and skills to the opening scenario.
3. **Active NPC**: Include at least one speaking NPC with quoted dialogue and clear personality.
4. **Immediate Hook**: Present a compelling problem, opportunity, or mystery requiring action.
5. **Clear Choices**: End with 2-3 specific action options with different approaches and consequences.
</structure>

<mechanics>
- If uncertain outcomes occur, specify needed dice rolls: "Make a Perception check (d20 + Wisdom modifier)".
- Reference character abilities that might be relevant: "Your training might help here".
- Include environmental details that suggest skill applications or tactical options.
- Set up potential ability checks, combat, or social interactions.
</mechanics>

<elements>
- Use appropriate atmosphere and tone throughout.
- Make the character feel central to unfolding events.
- Create both immediate and long-term stakes.
- Include sensory details (sights, sounds, smells, textures).
- Show why this character is the right person for this adventure.
- End with a clear "What do you do?" moment.
</elements>
</opening_scene_requirements>`;
          }

          // Add combat context if detected
          contextPrompt += this.formatCombatContext(combatDetection);

          // Add specific dice roll requirements for combat
          if (combatDetection.isCombat) {
            contextPrompt += `<combat_roll_requirements>
<title>IMMEDIATE DICE ROLL REQUEST REQUIREMENTS</title>
Based on the detected combat scenario, you MUST REQUEST these dice rolls using ROLL_REQUESTS_V1:
- Initiative rolls for any new combat participants
- Attack rolls for player offensive actions (DO NOT roll for the player - REQUEST the roll)
- Damage rolls following successful player attacks
- Saving throws for any effects or spells targeting the player
- Any ability checks mentioned by the player

**CRITICAL FOR COMBAT:**
- Player actions (attacks, spells, checks) → REQUEST rolls via ROLL_REQUESTS_V1 and STOP
- NPC/Enemy actions (attacks, saves) → Include in ROLL_REQUESTS_V1 with "autoExecute": true and "actorName": "Enemy Name"
- DO NOT roll dice for the player
- DO NOT narrate outcomes before receiving roll results
- END your response immediately after the ROLL_REQUESTS_V1 block
</combat_roll_requirements>`;
          }

          // Add voice context for multi-voice narration
          if (voiceContext) {
            contextPrompt += `<voice_optimization_format>
<title>CRITICAL: VOICE-OPTIMIZED RESPONSE FORMAT</title>
You MUST respond with JSON containing both display text AND pre-segmented narration for multi-voice synthesis.
**IMPORTANT: Return ONLY pure JSON - no markdown, no code blocks, no extra text!**

<segmentation_rules>
1. **Fewer, Better Segments**: Create 2-5 segments maximum per response.
2. **One Speaker Per Segment**: Each segment = one speaker (DM or specific character).
3. **Complete Thoughts**: Each segment should be a complete thought or dialogue turn.
4. **Speaker Turns**: Split only when the speaker changes (DM -> Character or Character A -> Character B).
</segmentation_rules>

<json_format>
{
  "text": "Your full response with proper quoted dialogue and dice roll results for display",
  "narration_segments": [
    { "type": "dm", "text": "Complete scene description and DM narration", "character": null, "voice_category": null },
    { "type": "character", "text": "Complete character dialogue without quotes", "character": "simple character name", "voice_category": "hero_male|villain_female|merchant|guard|elder|creature|etc" }
  ],
  "roll_requests": [
    { "type": "check|save|attack|damage|initiative", "formula": "1d20+5", "purpose": "Arcana check to understand the magical mechanism", "dc": 15, "advantage": false, "disadvantage": false }
  ]
}
</json_format>

<roll_request_requirements>
- ALWAYS include "roll_requests" array when requesting dice rolls from players.
- Include roll_requests for: player combat actions, skill checks, saving throws, initiative.
- Each roll_request must have: type, formula, purpose, and target (DC/AC) if applicable.
- Show roll requests in the "text" field: "Please roll 1d20+5 for your Arcana check (DC 15)"
</roll_request_requirements>

<voice_categories>hero_male, hero_female, villain_male, villain_female, merchant, guard, innkeeper, elder, child, creature, goblin, monster</voice_categories>
</voice_optimization_format>`;
          }

          contextPrompt += `<response_structure>
<title>DM RESPONSE GUIDELINES</title>
<core_principles>
- Respond to the player's action with clear consequences and vivid descriptions.
- Use D&D 5e mechanics when appropriate (ask for ability checks, saving throws, attacks).
- Include sensory details and environmental context.
- Track narrative threads and callback to previous events from memories.
- Give NPCs distinct voices and personalities.
</core_principles>

<structure>
1. **Consequences**: Describe what happens as a result of their action.
2. **New Information**: Reveal new details, clues, or developments.
3. **NPC Interaction**: Include direct quoted dialogue for ALL speaking NPCs.
4. **Environmental Details**: Paint the scene with sensory information.
5. **Choice Point**: End with 2-3 clear options UNLESS:
   - You are requesting a dice roll (END immediately after ROLL_REQUESTS_V1 block)
   - You are in COMBAT and narrating NPC turns (NO options until player's turn)
   - Combat turn order: Player acts → NPCs act → THEN give player options for their next turn

**CRITICAL FOR COMBAT**: After player completes their turn, narrate ALL NPC turns before giving options. Do not give player choices after every action - they get ONE turn, then enemies act.
</structure>

<visual_prompt_rule>
**OPTIONAL VISUAL PROMPT (for image generation):**
At the very end of the response, if the scene would benefit from an illustration, include a single concise line starting with:
VISUAL PROMPT: <short art prompt focusing on key visual elements>
Examples:
- VISUAL PROMPT: Moonlit forest clearing with ancient standing stones and swirling mist
- VISUAL PROMPT: Crumbling obsidian keep under stormy skies with lightning forks
Keep this to a single line; do not include quotes or extra commentary.
</visual_prompt_rule>

<player_choice_generation>
<title>CRITICAL: ACTION OPTIONS FORMATTING</title>

<verbalized_sampling_technique>
To ensure creative and diverse choices, first internally brainstorm 4-5 potential actions for the player. One of these must be an unconventional "wild card" option. Then, select the best 2-3 options from your brainstormed list to present to the player.
</verbalized_sampling_technique>

<formatting_rules>
You MUST format the final choices as lettered options with bold action names. This formatting is REQUIRED for the options to appear as clickable buttons in the game interface. Always include 2-3 options formatted this way at the end of your responses unless the situation clearly calls for a single specific action (like combat resolution).

Format: A. **Action Name**, brief description of what this choice involves

Examples:
- A. **Approach cautiously**, moving carefully to avoid detection while gathering information.
- B. **Charge forward boldly**, relying on speed and surprise to overcome obstacles.
- C. **Attempt to negotiate**, using your diplomatic skills to find a peaceful solution.
- D. **(Wild Card) Examine the strange runes,** trying to decipher their meaning even if it seems unrelated to the immediate threat.
</formatting_rules>
</player_choice_generation>

<final_prompt>
Keep responses engaging, 1-3 paragraphs, and always end with a clear prompt for player action or decision.
</final_prompt>
</response_structure>`;

          if (voiceContext) {
            contextPrompt += `\n**REMEMBER: Always respond in the JSON format with narration_segments for voice synthesis!**`;
          }

          // Add final reminder about roll stopping rule (most important - LLMs weight end of prompt more heavily)
          contextPrompt += `

<final_reminder>
<critical>MOST IMPORTANT RULE: If you request a dice roll using ROLL_REQUESTS_V1, your response MUST END with that block. Do NOT add narrative, choices, outcomes, or any text after the roll request. The player rolls first, then you continue the story in your NEXT response.</critical>
</final_reminder>

<memory_and_world_tags>
<title>STORY MEMORY AND WORLD STATE TRACKING</title>
After your narrative response, include these XML tags to help track important story elements:

<memories>
- Key fact or event the player should remember
- Important NPC relationship or dialogue
- Story-significant discovery or decision
</memories>

<world_updates>
- npc: Name | Brief description | Current location
- location: Name | Brief description | Status (revealed/visited/etc)
- quest: Quest name | Status update or new objective
</world_updates>

<guidelines>
- Include 1-3 memories per response (only truly significant moments)
- Only include world_updates when new NPCs, locations, or quests are introduced/changed
- Keep entries brief and factual
- These tags help maintain story continuity across sessions
</guidelines>

<example>
Your narrative response here...

<memories>
- Discovered that the innkeeper Marta is secretly a retired adventurer
- The strange symbol on the door matches one from the player's backstory
</memories>

<world_updates>
- npc: Marta | Retired adventurer running the Rusty Nail tavern | Millbrook village
- location: The Rusty Nail | Cozy tavern with mysterious cellar | visited
</world_updates>
</example>
</memory_and_world_tags>`;

          // Build conversation history
          const messages = [
            { role: 'user', parts: [{ text: contextPrompt }] },
            {
              role: 'model',
              parts: [{ text: "Understood! I'm ready to be your Dungeon Master." }],
            },
          ];

          // Add conversation history
          if (params.conversationHistory) {
            params.conversationHistory.forEach((msg) => {
              messages.push({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.content }],
              });
            });
          }

          const chat = model.startChat({
            history: messages,
            generationConfig: {
              temperature: 0.9,
              topK: 40,
              topP: 0.95,
              maxOutputTokens: 2048, // Increased from 1024 to prevent truncation
            },
          });

          // Use streaming if callback provided (note: streaming won't work with JSON parsing)
          if (params.onStream && !voiceContext) {
            const response = await chat.sendMessageStream(params.message);
            let fullResponse = '';

            for await (const chunk of response.stream) {
              const chunkText = chunk.text();
              fullResponse += chunkText;
              params.onStream(chunkText);
            }

            return { text: fullResponse };
          } else {
            const response = await chat.sendMessage(params.message);
            const result = await response.response;
            const rawResponse = result.text();

            // Try to parse structured response if voice context is available
            if (voiceContext) {
              try {
                // Clean the response by removing markdown code blocks first
                let cleanedResponse = rawResponse.trim();

                // Remove markdown code blocks (```json ... ```)
                cleanedResponse = cleanedResponse
                  .replace(/^```(?:json)?\s*/, '')
                  .replace(/\s*```$/, '');

                // Try to find JSON content if the response has extra text
                const jsonStart = cleanedResponse.indexOf('{');
                const jsonEnd = cleanedResponse.lastIndexOf('}');

                if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                  cleanedResponse = cleanedResponse.substring(jsonStart, jsonEnd + 1);
                }

                // Additional cleanup for common JSON formatting issues
                cleanedResponse = cleanedResponse
                  .replace(/,\s*}/g, '}') // Remove trailing commas before }
                  .replace(/,\s*]/g, ']') // Remove trailing commas before ]
                  .replace(/}\s*{/g, '},{') // Fix missing commas between objects
                  .replace(/"\s*:\s*"([^"]*?)"\s*([,}])/g, '":"$1"$2'); // Fix spacing issues

                // Parse the cleaned JSON
                const structuredResponse = JSON.parse(cleanedResponse);
                logger.debug('🎭 Successfully parsed structured voice response');

                // 🔍 DEBUG: Log the raw AI response structure
                logger.debug('📥 RAW AI RESPONSE:', JSON.stringify(structuredResponse, null, 2));

                if (structuredResponse.narration_segments) {
                  logger.debug('📊 AI SEGMENTS ANALYSIS:');
                  structuredResponse.narration_segments.forEach(
                    (segment: NarrationSegment, idx: number) => {
                      logger.debug(`  Segment ${idx + 1}:`, {
                        type: segment.type,
                        character: segment.character,
                        voice_category: segment.voice_category,
                        text_length: segment.text?.length || 0,
                        text_preview: segment.text?.substring(0, 50) + '...',
                      });
                    },
                  );
                }

                return structuredResponse;
              } catch (parseError) {
                logger.warn(
                  'Failed to parse structured response, attempting to extract text:',
                  parseError,
                );

                // Try to extract text from malformed JSON
                try {
                  // Look for text field in the response even if JSON is malformed
                  const textMatch = rawResponse.match(/"text"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/);
                  if (textMatch) {
                    const extractedText = textMatch[1]
                      .replace(/\\"/g, '"')
                      .replace(/\\n/g, '\n')
                      .replace(/\\\\/g, '\\');
                    logger.debug('🔧 Extracted text from malformed JSON');
                    return { text: extractedText };
                  }
                } catch (extractError) {
                  logger.warn('Could not extract text from malformed JSON:', extractError);
                }

                // Final fallback - return raw response with minimal cleaning
                // Only remove obvious JSON structure markers if they exist
                let cleanText = rawResponse;
                if (cleanText.trim().startsWith('{') && cleanText.includes('"text"')) {
                  // Try to find where the actual text content starts and ends
                  const startMatch = cleanText.match(/"text"\s*:\s*"/);
                  if (startMatch) {
                    const startIndex = startMatch.index! + startMatch[0].length;
                    let textContent = cleanText.substring(startIndex);

                    // Find the end of the text content (look for quote followed by comma or closing brace)
                    const endMatch = textContent.match(/"\s*[,}]/);
                    if (endMatch) {
                      textContent = textContent.substring(0, endMatch.index);
                    } else {
                      // If no clear end found, look for the last quote
                      const lastQuoteIndex = textContent.lastIndexOf('"');
                      if (lastQuoteIndex > 0) {
                        textContent = textContent.substring(0, lastQuoteIndex);
                      }
                    }

                    // Unescape the content
                    cleanText = textContent
                      .replace(/\\"/g, '"')
                      .replace(/\\n/g, '\n')
                      .replace(/\\\\/g, '\\');
                  }
                }
                return { text: cleanText || rawResponse };
              }
            }

            return { text: rawResponse };
          }
        });

        logger.info('Successfully generated DM response using local Gemini API');

        // Process voice assignments if we have structured data
        if (result.narration_segments && params.context.sessionId && voiceContext) {
          try {
            // Normalize segment types for compatibility
            type VoiceSegment = {
              type: string;
              text: string;
              character?: string;
              voice_category?: string;
            };
            const normalizedSegments: VoiceSegment[] = result.narration_segments.map(
              (segment: NarrationSegment) => ({
                ...segment,
                type:
                  segment.type === 'dm'
                    ? 'narration'
                    : segment.type === 'character'
                      ? 'dialogue'
                      : (segment.type as string),
              }),
            );

            await voiceConsistencyService.processVoiceAssignments(
              params.context.sessionId,
              normalizedSegments,
            );
            logger.info('🎪 Processed voice assignments for character consistency');
          } catch (voiceError) {
            logger.warn('Voice assignment processing failed (non-fatal):', voiceError);
          }
        }

        // ========================================================================
        // PHASE 2: XML-TAGGED MEMORY AND WORLD EXTRACTION (Single-call approach)
        // Instead of making separate API calls, parse XML tags from the DM response
        // ========================================================================
        if (params.context.sessionId) {
          // Parse XML tags from the response
          const xmlParsed = parseXMLTagsFromResponse(result.text);

          // If XML tags were found, use them directly (no additional API calls!)
          if (xmlParsed.hadTags) {
            logger.info(`📋 Found XML tags in DM response: ${xmlParsed.memories.length} memories, ${xmlParsed.worldUpdates.npcs.length} NPCs, ${xmlParsed.worldUpdates.locations.length} locations, ${xmlParsed.worldUpdates.quests.length} quests`);

            // Store memories from XML tags (no API call needed)
            if (xmlParsed.memories.length > 0) {
              try {
                // Match the actual memories table schema
                // Required: session_id, content
                // Optional: campaign_id, memory_type, type, importance, context, metadata
                const memoriesToSave = xmlParsed.memories.map((content) => ({
                  session_id: params.context.sessionId!,
                  campaign_id: params.context.campaignId,
                  content,
                  type: 'event',
                  memory_type: 'story_event',
                  importance: 4, // Integer 1-5, 4 = moderately important (MemoryService normalizes to 1-5)
                  metadata: { source: 'xml_extraction', characterId: params.context.characterId },
                }));
                await MemoryManager.saveMemories(memoriesToSave);
                logger.info(`🧠 Saved ${memoriesToSave.length} memories from XML tags (no extra API call)`);
              } catch (memoryError) {
                logger.warn('Failed to save XML-extracted memories (non-fatal):', memoryError);
              }
            }

            // Process world updates from XML tags (no API call needed)
            const hasWorldUpdates = xmlParsed.worldUpdates.npcs.length > 0 ||
              xmlParsed.worldUpdates.locations.length > 0 ||
              xmlParsed.worldUpdates.quests.length > 0;

            if (hasWorldUpdates) {
              try {
                // Store NPCs directly
                for (const npc of xmlParsed.worldUpdates.npcs) {
                  await WorldBuilderService.saveNPCFromXML(
                    params.context.campaignId,
                    params.context.sessionId!,
                    npc,
                  );
                }
                // Store locations directly
                for (const loc of xmlParsed.worldUpdates.locations) {
                  await WorldBuilderService.saveLocationFromXML(
                    params.context.campaignId,
                    params.context.sessionId!,
                    loc,
                  );
                }
                // Store quests directly
                for (const quest of xmlParsed.worldUpdates.quests) {
                  await WorldBuilderService.saveQuestFromXML(
                    params.context.campaignId,
                    params.context.sessionId!,
                    quest,
                  );
                }
                logger.info(`🌍 World expanded from XML: +${xmlParsed.worldUpdates.locations.length} locations, +${xmlParsed.worldUpdates.npcs.length} NPCs, +${xmlParsed.worldUpdates.quests.length} quests (no extra API calls)`);
              } catch (worldError) {
                logger.warn('Failed to save XML-extracted world updates (non-fatal):', worldError);
              }
            }

            // Update result.text to be the clean narrative without XML tags
            result.text = xmlParsed.narrative;
          } else {
            // No XML tags found - fall back to traditional extraction (with batching in Phase 3)
            logger.info('⚠️ No XML tags found in DM response, using fallback extraction');

            // Graceful degradation: free tier only extracts memories every 3rd turn
            const shouldExtractMemory =
              params.userPlan === 'pro' ||
              params.userPlan === 'enterprise' ||
              !params.userPlan || // Default to extracting if plan is unknown
              (params.turnCount !== undefined && params.turnCount % 3 === 0);

            if (shouldExtractMemory) {
              try {
                const memoryContext: MemoryContext = {
                  sessionId: params.context.sessionId,
                  campaignId: params.context.campaignId,
                  characterId: params.context.characterId,
                  currentMessage: params.message,
                  recentMessages:
                    params.conversationHistory?.slice(-5).map((msg) => msg.content) || [],
                };

                const extractionResult = await MemoryManager.extractMemories(
                  memoryContext,
                  params.message,
                  result.text,
                );

                if (extractionResult.memories.length > 0) {
                  await MemoryManager.saveMemories(extractionResult.memories);
                  logger.info(`🧠 Extracted and saved ${extractionResult.memories.length} memories (fallback API call)`);
                }
              } catch (memoryError) {
                logger.warn('Memory extraction failed (non-fatal):', memoryError);
              }
            } else {
              logger.info(
                `⏭️ Skipping memory extraction for free tier (turn ${params.turnCount}, next extraction on turn ${params.turnCount ? Math.ceil((params.turnCount + 1) / 3) * 3 : 'unknown'})`,
              );
            }

            // Expand world based on player action and AI response (fallback)
            try {
              const worldExpansion = await WorldBuilderService.respondToPlayerAction(
                params.context.campaignId,
                params.context.sessionId!,
                params.context.characterId,
                params.message,
                result.text,
              );

              if (
                worldExpansion &&
                worldExpansion.locations.length +
                  worldExpansion.npcs.length +
                  worldExpansion.quests.length >
                  0
              ) {
                logger.info(
                  `🌍 World expanded (fallback): +${worldExpansion.locations.length} locations, +${worldExpansion.npcs.length} NPCs, +${worldExpansion.quests.length} quests`,
                );
              }
            } catch (worldError) {
              logger.warn('World building failed (non-fatal):', worldError);
            }
          }
        }

        // Add combat detection data to the result
        const enhancedResult = {
          ...result,
          combatDetection: {
            isCombat: combatDetection.isCombat,
            confidence: combatDetection.confidence,
            combatType: combatDetection.combatType,
            shouldStartCombat: combatDetection.shouldStartCombat,
            shouldEndCombat: combatDetection.shouldEndCombat,
            enemies: combatDetection.enemies || [],
            combatActions: combatDetection.combatActions || [],
          },
        };

        return enhancedResult;
      } catch (geminiError) {
        logger.error('Local Gemini API failed:', geminiError);
        throw new Error('Failed to get DM response - AI service unavailable');
      }
    })(); // End of the async promise wrapper

    // Store promise in in-flight map and return it
    inFlight.set(key, { ts: now, promise: p });
    return p;
  }

  /**
   * Save a chat message to the database
   */
  static async saveChatMessage(params: {
    sessionId: string;
    role: 'user' | 'assistant';
    content: string;
    speakerId?: string;
    id?: string;
  }): Promise<void> {
    try {
      const messageId = params.id || crypto.randomUUID();
      const { error } = await supabase.from('dialogue_history').insert({
        id: messageId,
        session_id: params.sessionId,
        speaker_type: params.role,
        speaker_id: params.speakerId,
        message: params.content,
      });

      if (error) {
        logger.error('Error saving chat message:', error);
        throw new Error('Failed to save chat message');
      }
    } catch (error) {
      logger.error('Error saving chat message:', error);
      throw error;
    }
  }

  /**
   * Get conversation history for a session
   */
  static async getConversationHistory(sessionId: string): Promise<ChatMessage[]> {
    try {
      const { data, error } = await supabase
        .from('dialogue_history')
        .select('*')
        .eq('session_id', sessionId)
        .order('sequence_number', { ascending: true });

      if (error) {
        logger.error('Error getting conversation history:', error);
        throw new Error('Failed to get conversation history');
      }

      return data.map((msg) => ({
        id: msg.id,
        role: msg.speaker_type as 'user' | 'assistant',
        content: msg.message,
        timestamp: msg.created_at ? new Date(msg.created_at) : new Date(),
      }));
    } catch (error) {
      logger.error('Error getting conversation history:', error);
      throw error;
    }
  }

  /**
   * Generate an opening message for a new campaign session
   * Delegates to modular opening-message-generator.ts which includes verbalized sampling
   */
  static async generateOpeningMessage(params: { context: GameContext }): Promise<string> {
    // Delegate to modular opening message generator (includes verbalized sampling)
    return generateOpeningMessage(params);
  }

  /**
   * Get default equipment for a character class
   * Used to provide the AI with weapon damage dice information
   */
  private static getClassEquipment(className: string): { weapons: string[]; armor: string } {
    const classLower = className.toLowerCase();

    switch (classLower) {
      case 'fighter':
        return {
          weapons: ['Longsword (1d8)', 'Shortsword (1d6)', 'Handaxe (1d6)', 'Light Crossbow (1d8)'],
          armor: 'Chain mail (AC 16)',
        };

      case 'rogue':
        return {
          weapons: ['Shortsword (1d6)', 'Dagger (1d4)', 'Shortbow (1d6)', 'Rapier (1d8)'],
          armor: 'Leather armor (AC 11)',
        };

      case 'ranger':
        return {
          weapons: ['Longsword (1d8)', 'Shortsword (1d6)', 'Longbow (1d8)', 'Handaxe (1d6)'],
          armor: 'Studded leather (AC 12)',
        };

      case 'barbarian':
        return {
          weapons: ['Greataxe (1d12)', 'Handaxe (1d6)', 'Javelin (1d6)'],
          armor: 'Unarmored (AC 10 + Dex + Con)',
        };

      case 'wizard':
        return {
          weapons: ['Dagger (1d4)', 'Dart (1d4)', 'Light Crossbow (1d8)', 'Quarterstaff (1d6)'],
          armor: 'No armor (AC 10)',
        };

      case 'sorcerer':
        return {
          weapons: ['Dagger (1d4)', 'Dart (1d4)', 'Light Crossbow (1d8)', 'Quarterstaff (1d6)'],
          armor: 'No armor (AC 10)',
        };

      case 'warlock':
        return {
          weapons: ['Dagger (1d4)', 'Light Crossbow (1d8)', 'Scimitar (1d6)'],
          armor: 'Leather armor (AC 11)',
        };

      case 'cleric':
        return {
          weapons: ['Mace (1d6)', 'Warhammer (1d8)', 'Light Crossbow (1d8)', 'Shield'],
          armor: 'Scale mail (AC 14)',
        };

      case 'druid':
        return {
          weapons: ['Scimitar (1d6)', 'Shield', 'Dart (1d4)', 'Javelin (1d6)'],
          armor: 'Leather armor (AC 11)',
        };

      case 'paladin':
        return {
          weapons: ['Longsword (1d8)', 'Javelin (1d6)', 'Shield'],
          armor: 'Chain mail (AC 16)',
        };

      case 'bard':
        return {
          weapons: ['Rapier (1d8)', 'Shortsword (1d6)', 'Dagger (1d4)', 'Hand Crossbow (1d6)'],
          armor: 'Leather armor (AC 11)',
        };

      case 'monk':
        return {
          weapons: ['Shortsword (1d6)', 'Dart (1d4)', 'Unarmed Strike (1d4)'],
          armor: 'Unarmored (AC 10 + Dex + Wis)',
        };

      default:
        return {
          weapons: ['Longsword (1d8)', 'Shortsword (1d6)', 'Dagger (1d4)'],
          armor: 'Leather armor (AC 11)',
        };
    }
  }

  /**
   * Get Gemini API manager statistics (for debugging)
   */
  static getApiStats(): {
    currentKey: ReturnType<GeminiApiManager['getCurrentKeyInfo']>;
    allKeyStats: ReturnType<GeminiApiManager['getStats']>;
    rateLimits: ReturnType<GeminiApiManager['getRateLimitStats']>;
  } {
    try {
      const manager = this.getGeminiManager();
      return {
        currentKey: manager.getCurrentKeyInfo(),
        allKeyStats: manager.getStats(),
        rateLimits: manager.getRateLimitStats(),
      };
    } catch (error) {
      return { error: 'Gemini API manager not available' } as unknown as {
        currentKey: ReturnType<GeminiApiManager['getCurrentKeyInfo']>;
        allKeyStats: ReturnType<GeminiApiManager['getStats']>;
        rateLimits: ReturnType<GeminiApiManager['getRateLimitStats']>;
      };
    }
  }
}
