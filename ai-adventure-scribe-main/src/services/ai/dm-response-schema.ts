// Compatibility entrypoint for frontend callers. The server-owned module is the
// canonical DM response contract so browser and Bun structured-output schemas
// cannot drift.
export {
  createDmResponseSchema,
  dmResponseSchema,
  isHandoutAction,
  MAX_HANDOUT_ACTIONS_PER_REQUEST,
  parseDmResponse,
} from '../../../server-bun/src/services/dm/dm-response-schema';

export type {
  DMAoESpellAction,
  DMCombatAction,
  DMHandoutAction,
  DMMapAction,
  DMResponse,
  DMTargetedCombatAction,
  ForcedMoveAction,
  ForcedMoveMode,
} from '../../../server-bun/src/services/dm/dm-response-schema';
