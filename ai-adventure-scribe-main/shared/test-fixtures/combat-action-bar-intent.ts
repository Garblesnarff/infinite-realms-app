/**
 * The StructuredCombatAction the action bar builds from a `Cast Chill Touch` legal action, as
 * both the client (use-combat-legal-actions.ts) and the real route (server-bun) see it. Shared so
 * the client test can assert it sends exactly this body and the server test can post exactly it.
 */
export const ACTION_BAR_ACTOR_ID = 'pc-1';
export const ACTION_BAR_TARGET_ID = 'goblin-1';

export const ACTION_BAR_CAST_INTENT = {
  actor_id: ACTION_BAR_ACTOR_ID,
  action_type: 'cast_spell',
  target_ids: [ACTION_BAR_TARGET_ID],
  weapon_id: null,
  spell_id: 'chill-touch',
  slot_level: null,
  movement_feet: 0,
} as const;
