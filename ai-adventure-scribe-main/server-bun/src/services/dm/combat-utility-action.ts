import {
  HELP_REFUSAL,
  READY_REFUSAL,
  objectCombatIntent,
} from '../../../../shared/combat-object-action.js';
import { BusinessLogicError } from '../../lib/errors.js';

export async function resolveCombatUtilityAction(
  sessionId: string,
  userId: string,
  playerInput: string,
): Promise<string | null> {
  const text = playerInput
    .trim()
    .replace(/^i\s+(?:try to\s+)?/i, '')
    .replace(/[.!]+$/, '');
  if (text.includes('?')) return null;
  const search = /^search\b/i.test(text);
  const help = /^help\b/i.test(text);
  const ready = /^ready\b/i.test(text);
  const object = /^use\s+(?:the |my |an? )?(.+)$/i.exec(text);
  const drink = /^drink\s+(?:the |my |an? )?(potion of healing|healing potion)$/i.exec(text);
  // Feature and spell declarations have their own paths. Only intercept a named
  // potion or an explicit Use an Object declaration.
  const objectAction = /^use\s+(?:an\s+)?object\b/i.test(text);
  const potion =
    drink?.[1] ??
    (/^(potion of healing|healing potion)$/i.test(object?.[1] ?? '') ? object?.[1] : undefined);
  if (!search && !help && !ready && !objectAction && !potion) return null;

  const { CombatEncounterService } = await import('../combat/combat-encounter-service.js');
  const encounter = await CombatEncounterService.getActiveEncounter(sessionId, userId);
  if (!encounter) return null;
  if (help) return HELP_REFUSAL;
  if (ready) return READY_REFUSAL;

  const state = await CombatEncounterService.getCombatState(encounter.id, userId);
  const actor = state.participants.find(
    (participant) =>
      participant.participantType === 'player' && participant.id === state.currentParticipant?.id,
  );
  if (!actor) return 'Wait for your turn before taking an action.';

  const intent = search
    ? { type: 'check' as const, checkKind: 'search' as const, actorId: actor.id }
    : objectCombatIntent(actor.id, potion ?? object?.[1]?.replace(/^object\s*[:–-]?\s*/i, ''));
  const { executeCombatIntent } = await import('../combat/combat-intent-service.js');
  try {
    const result = (await executeCombatIntent(
      encounter.id,
      { ...intent, expectedVersion: state.encounter.version },
      userId,
      'player',
      undefined,
      'typed',
      playerInput,
    )) as {
      engineLine?: string;
      itemName?: string;
      healed?: number;
      newHp?: number;
      maxHp?: number;
    };
    if (result.engineLine) return result.engineLine;
    if (result.itemName && typeof result.healed === 'number') {
      return `${actor.name} used ${result.itemName} and regained ${result.healed} HP (HP ${result.newHp}/${result.maxHp}).`;
    }
    return 'The action could not be resolved. Refresh combat and try again.';
  } catch (error) {
    if (error instanceof BusinessLogicError) return error.message;
    throw error;
  }
}
