/**
 * The action types `getLegalCombatActions` (server-bun/src/services/combat/combat-intent-service.ts)
 * can return on a player's turn. Shared so the client's placement coverage test can enumerate
 * them instead of scraping producer source.
 */
export const LEGAL_ACTION_TYPES = [
  'attack',
  'spell',
  'move',
  'dash',
  'dodge',
  'disengage',
  'second_wind',
  'action_surge',
  'flee',
  'yield',
  'death_save',
  'end_turn',
] as const;

export type LegalActionType = (typeof LEGAL_ACTION_TYPES)[number];
