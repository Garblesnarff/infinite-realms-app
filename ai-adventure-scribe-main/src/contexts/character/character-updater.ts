import type { CharacterState } from './types';
import type { Character } from '@/types/character';

import logger from '@/lib/logger';

/**
 * Handles the UPDATE_CHARACTER action logic.
 * Extracted from characterReducer to improve maintainability.
 */
export function handleUpdateCharacter(
  state: CharacterState,
  payload: Partial<Character>,
): CharacterState {
  // Only log when there are actual changes to reduce noise
  const currentCharacter = state.character;
  const hasChanges =
    currentCharacter &&
    payload &&
    Object.keys(payload).some((key) => {
      const currentValue = currentCharacter[key as keyof Character];
      const newValue = payload[key as keyof typeof payload];
      return JSON.stringify(currentValue) !== JSON.stringify(newValue);
    });

  if (hasChanges) {
    logger.debug('UPDATE_CHARACTER reducer called');
    logger.debug('Current state.character:', state.character);
    logger.debug('Action payload:', payload);

    // Special logging for spell-related updates
    if (payload.cantrips || payload.knownSpells || payload.preparedSpells || payload.ritualSpells) {
      logger.debug('[CharacterContext] Spell update detected:', {
        incomingCantrips: payload.cantrips,
        incomingKnownSpells: payload.knownSpells,
        incomingPreparedSpells: payload.preparedSpells,
        incomingRitualSpells: payload.ritualSpells,
        currentCantrips: state.character?.cantrips,
        currentKnownSpells: state.character?.knownSpells,
        currentPreparedSpells: state.character?.preparedSpells,
        currentRitualSpells: state.character?.ritualSpells,
      });
    }
  }

  // Validate current character state
  if (!state.character || typeof state.character !== 'object') {
    logger.error('No character to update or invalid character state');
    return {
      ...state,
      error: 'No character data to update',
    };
  }

  // Validate payload
  if (!payload || typeof payload !== 'object') {
    logger.error('Invalid update payload:', payload);
    return {
      ...state,
      error: 'Invalid character update data',
    };
  }

  // Safe merge with validation
  const updatedCharacter = {
    ...state.character,
    ...payload,
  };

  // Additional logging for spell updates - include both property naming conventions
  if (
    hasChanges &&
    (payload.cantrips || payload.knownSpells || payload.preparedSpells || payload.ritualSpells)
  ) {
    logger.debug('[CharacterContext] Final spell state after update:', {
      finalCantrips: updatedCharacter.cantrips,
      finalKnownSpells: updatedCharacter.knownSpells,
      finalPreparedSpells: updatedCharacter.preparedSpells,
      finalRitualSpells: updatedCharacter.ritualSpells,
      cantripCount: updatedCharacter.cantrips?.length || 0,
      spellCount: updatedCharacter.knownSpells?.length || 0,
      preparedSpellCount: updatedCharacter.preparedSpells?.length || 0,
      ritualSpellCount: updatedCharacter.ritualSpells?.length || 0,
    });
  }

  return {
    ...state,
    character: updatedCharacter,
    isDirty: state.isDirty || !!hasChanges,
    error: null, // Clear any previous errors on successful update
  };
}
