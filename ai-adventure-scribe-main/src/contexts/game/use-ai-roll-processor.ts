import { type Dispatch, useCallback, useMemo } from 'react';
import { v4 as uuidv4 } from 'uuid';

import type { GameAction } from './game-reducer';
import type { Character } from '@/types/character';
import type { DiceRollRequest, DiceRollRequestType, DamageType } from '@/types/combat';

import { useCharacter } from '@/contexts/CharacterContext';
import logger from '@/lib/logger';
import { throttle } from '@/lib/utils';
import {
  calculateRollWithBreakdown,
  SKILL_ABILITIES,
  SKILL_ALIASES,
  type AbilityName,
} from '@/utils/characterModifiers';

/**
 * Shape of a roll request from AI responses, before conversion
 * to the internal DiceRollRequest format.
 */
export interface AiRollRequest {
  type: string;
  participantId?: string;
  purpose?: string;
  description?: string;
  formula?: string;
  advantage?: boolean;
  disadvantage?: boolean;
  dc?: number;
  ac?: number;
  target?: string;
  damageType?: DamageType;
}

/**
 * Hook that encapsulates AI response processing logic.
 * Extracted from GameContext.tsx for better maintainability.
 *
 * @param dispatch - Dispatch function from useReducer
 * @param requestDiceRoll - Function to request a dice roll
 */
export const useAiRollProcessor = (
  dispatch: Dispatch<GameAction>,
  requestDiceRoll: (request: Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'>) => string,
): {
  processAiResponse: (rollRequests: AiRollRequest[]) => void;
  throttledProcessAiResponse: (rollRequests: AiRollRequest[]) => void;
} => {
  const { state: characterState } = useCharacter();
  const character = characterState.character;
  // The current game session has one player character; participantId remains metadata until party-scoped lookup exists.

  /**
   * Process AI response and extract dice roll requests with deduplication
   * Enhanced with batch tracking for multi-roll scenarios
   *
   * Fixed: Properly memoized with requestDiceRoll dependency.
   * Since requestDiceRoll has stable reference (empty deps), this handler won't recreate unnecessarily.
   */
  const processAiResponse = useCallback(
    (rollRequests: AiRollRequest[]) => {
      logger.info('🤖 Processing AI response with roll requests:', rollRequests);

      if (!rollRequests || !Array.isArray(rollRequests)) {
        logger.warn('🎲 No valid roll requests to process');
        return;
      }

      // Log initiative rolls specifically for debugging
      const initiativeRolls = rollRequests.filter((r: AiRollRequest) => r.type === 'initiative');
      if (initiativeRolls.length > 0) {
        logger.info('🎯 Processing INITIATIVE roll request(s):', initiativeRolls);
      }

      // Generate batchId if multiple rolls are requested
      const batchId = rollRequests.length > 1 ? uuidv4() : undefined;

      if (batchId) {
        logger.info('🎲 Creating batch with ID:', batchId);
        dispatch({ type: 'SET_CURRENT_BATCH', payload: batchId });
      }

      // Track this AI response
      const processedRollRequests: DiceRollRequest[] = [];

      const seenKeys = new Set<string>();

      rollRequests.forEach((request: AiRollRequest) => {
        try {
          // Convert AI request format to our internal format
          const parsedFormula = parseRollFormula(request.formula);
          const rollRequest: Omit<DiceRollRequest, 'id' | 'timestamp' | 'status'> = {
            requestType: request.type as DiceRollRequestType,
            participantId: request.participantId,
            description: request.purpose || request.description || 'Dice roll requested',
            rollConfig: {
              dieType: 20, // Default to d20, parse from formula if available
              count: 1,
              modifier: 0,
              advantage: request.advantage || false,
              disadvantage: request.disadvantage || false,
              ...buildCharacterDerivedRollConfig(request, parsedFormula, character),
            },
            batchId, // Assign batch ID
            dc: request.dc, // Extract DC for skill checks and saves
            ac: request.ac, // Extract AC for attack rolls
            // Fields for damage_taken type (incoming damage to player)
            target: request.target, // "player" or NPC name
            damageType: request.damageType, // fire, cold, slashing, etc.
          };

          const dedupeKey = [
            rollRequest.requestType,
            rollRequest.participantId || 'any',
            rollRequest.description,
            rollRequest.rollConfig.dieType,
            rollRequest.rollConfig.count,
            rollRequest.rollConfig.modifier,
            rollRequest.rollConfig.abilityModifier || '',
            rollRequest.rollConfig.advantage ? 'adv' : '',
            rollRequest.rollConfig.disadvantage ? 'dis' : '',
          ].join('|');

          if (seenKeys.has(dedupeKey)) {
            logger.info('🎲 Skipping duplicate AI roll request before queue:', rollRequest);
            return;
          }

          seenKeys.add(dedupeKey);

          const rollId = requestDiceRoll(rollRequest);
          processedRollRequests.push({
            ...rollRequest,
            id: rollId,
            timestamp: new Date(),
            status: 'pending',
          });
        } catch (error) {
          logger.warn('Failed to process roll request:', request, error);
        }
      });

      dispatch({ type: 'SET_AI_RESPONSE', payload: { rollRequests: processedRollRequests } });
    },
    [character, dispatch, requestDiceRoll],
  );

  /**
   * Throttled version of processAiResponse
   */
  const throttledProcessAiResponse = useMemo(
    () => throttle(processAiResponse, 500),
    [processAiResponse],
  );

  return {
    processAiResponse,
    throttledProcessAiResponse,
  };
};

const SKILL_TERMS = Array.from(
  new Set([...Object.keys(SKILL_ABILITIES), ...Object.keys(SKILL_ALIASES)]),
).sort((a, b) => b.length - a.length);

const ABILITY_TERMS: ReadonlyArray<[AbilityName, string[]]> = [
  ['strength', ['strength', 'str']],
  ['dexterity', ['dexterity', 'dex']],
  ['constitution', ['constitution', 'con']],
  ['intelligence', ['intelligence', 'int']],
  ['wisdom', ['wisdom', 'wis']],
  ['charisma', ['charisma', 'cha']],
];

function containsTerm(text: string, term: string): boolean {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^a-z])${escapedTerm}(?:$|[^a-z])`, 'i').test(text);
}

function findDeclaredSkill(request: AiRollRequest): string | undefined {
  const text = `${request.purpose || ''} ${request.formula || ''}`;
  const term = SKILL_TERMS.find((candidate) => containsTerm(text, candidate));
  return term ? SKILL_ALIASES[term] || term : undefined;
}

function findDeclaredAbility(request: AiRollRequest): AbilityName | undefined {
  const text = `${request.purpose || ''} ${request.formula || ''}`;
  for (const [ability, terms] of ABILITY_TERMS) {
    if (terms.some((term) => containsTerm(text, term))) return ability;
  }
  return undefined;
}

/**
 * Build the modifier for a player ability/skill check from the loaded character record.
 *
 * The DM request supplies the dice shape and the declared action context, but never an
 * authoritative modifier. Numeric formula modifiers are retained only as a no-character
 * fallback; a loaded character always wins so prose such as "using proficiency" cannot change
 * the result.
 */
function buildCharacterDerivedRollConfig(
  request: AiRollRequest,
  parsedFormula: Partial<DiceRollRequest['rollConfig']>,
  character: Character | null,
): Partial<DiceRollRequest['rollConfig']> {
  if (!character || !['check', 'skill_check'].includes(request.type)) {
    return parsedFormula;
  }

  try {
    const skillName = findDeclaredSkill(request);
    const calculation = skillName
      ? calculateRollWithBreakdown(character, 'skill', undefined, skillName)
      : (() => {
          const ability = findDeclaredAbility(request);
          return ability ? calculateRollWithBreakdown(character, 'check', ability) : null;
        })();

    if (!calculation) {
      logger.warn('roll_modifier_prose_fallback', {
        purpose: request.purpose || request.description || '',
      });
      return parsedFormula;
    }

    return {
      ...parsedFormula,
      modifier: calculation.totalModifier,
      // Do not let the UI resolve the model's symbolic modifier a second time.
      abilityModifier: undefined,
    };
  } catch (error) {
    logger.warn('Failed to derive roll modifier from character record:', request, error);
    return parsedFormula;
  }
}

/**
 * Parse a dice formula string to extract die type, count, and modifier
 */
function parseRollFormula(formula?: string): Partial<DiceRollRequest['rollConfig']> {
  if (!formula) return {};

  try {
    // Match patterns like "1d20+5", "2d6", "1d8-2", etc. (numeric modifiers)
    const numericMatch = formula.match(/^(\d+)?d(\d+)([-+]\d+)?$/);
    if (numericMatch) {
      const [, countStr, dieTypeStr, modifierStr] = numericMatch;
      return {
        count: countStr ? parseInt(countStr) : 1,
        dieType: parseInt(dieTypeStr),
        modifier: modifierStr ? parseInt(modifierStr) : 0,
      };
    }

    // Match patterns like "1d20+dex", "1d20+str", etc. (symbolic modifiers)
    // These will be resolved by the DiceRollRequest component using character stats
    const symbolicMatch = formula.match(/^(\d+)?d(\d+)([-+])([a-z]+)$/);
    if (symbolicMatch) {
      const [, countStr, dieTypeStr, , abilityStr] = symbolicMatch;
      logger.info('🎲 Parsed roll with symbolic modifier:', formula, '→ ability:', abilityStr);
      return {
        count: countStr ? parseInt(countStr) : 1,
        dieType: parseInt(dieTypeStr),
        modifier: 0, // Component resolves actual modifier from character stats
        abilityModifier: abilityStr, // preserved for UI resolution e.g. "cha", "int", "wis"
      };
    }

    logger.warn('🎲 Could not parse roll formula:', formula);
    return {};
  } catch (error) {
    logger.warn('Failed to parse roll formula:', formula, error);
    return {};
  }
}
