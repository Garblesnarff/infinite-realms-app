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

/**
 * The wire body a player-side Flee click on the action bar posts to
 * `/v1/combat/:encounterId/intent` (#1169).
 *
 * Copied from the real producers, not invented for the tests:
 *  - producer: `src/features/game-session/hooks/use-combat-legal-actions.ts` flee/yield
 *    branch calls `executeAuthoritativeCombatIntent(encounter.id, { type: action.type, actorId }, 'dm', Date.now(), 'action_bar')`.
 *  - producer: `src/services/combat/combat-action-executor.ts` `executeAuthoritativeCombatIntent`
 *    posts JSON body `{ intent, source, dmStartedAt, origin, playerInput? }`. With source 'dm'
 *    the status read is skipped, so no `expectedVersion` is sent.
 */
export function actionBarFleeIntentBody(actorId: string, dmStartedAt: number) {
  return {
    intent: { type: 'flee' as const, actorId },
    source: 'dm' as const,
    dmStartedAt,
    origin: 'action_bar' as const,
  };
}

/**
 * The wire body a DM-declared "I flee from the fight" typed turn posts (#1169).
 *
 * Copied from the real producer: `combat-action-executor.ts`'s
 * `action.action_type === 'yield' || 'flee'` branch posts `{ intent, source, dmStartedAt, origin, playerInput }`.
 */
export function typedFleeIntentBody(
  actorId: string,
  dmStartedAt: number,
  playerInput = 'I flee from the fight',
) {
  return {
    intent: { type: 'flee' as const, actorId },
    source: 'dm' as const,
    dmStartedAt,
    origin: 'typed' as const,
    playerInput,
  };
}
