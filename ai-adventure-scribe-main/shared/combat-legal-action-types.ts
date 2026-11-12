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
  'divine_sense',
  'divine_smite',
  /** #1233: Flexible Casting, a bonus action: convert a slot to sorcery points, or create a slot. */
  'flexible_casting',
  /** #1233: a known Metamagic option the Sorcerer can pay for; the client arms it for the next cast. */
  'metamagic',
  /**
   * #1414: spend Inspiration — advantage on the next roll. Not an action in 5e: the chip
   * arms the advantage and the roll that consumes it pays server-side; the chip itself
   * spends nothing.
   */
  'inspiration',
  'use_item',
  'flee',
  'yield',
  'death_save',
  'end_turn',
] as const;

export type LegalActionType = (typeof LEGAL_ACTION_TYPES)[number];
