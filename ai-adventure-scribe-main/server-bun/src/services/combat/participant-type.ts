/**
 * The participant_type a combat_participants row may carry.
 *
 * These four -- minus 'enemy', which nothing writes -- are exactly what the
 * `combat_participants_participant_type_check` constraint allows (see the
 * comment at db/schema/combat.ts:107). The union is the point: it makes
 * 'other' a compile error rather than a Postgres 23514 at runtime.
 *
 * A name-only combatant (no character, no npc) becomes 'monster', not
 * 'other' and not 'enemy'. Two reasons, in order of importance:
 *
 *   1. 'other' violates the check constraint outright. Seating a name-only
 *      combatant -- a supported path, see combatant-stat-resolution.ts's
 *      generic-NPC fallback -- failed the INSERT and 500'd the whole combat
 *      entry (#1987, found by #1979's real-db roster test).
 *   2. 'monster' is what the combat UI filters on for enemies. EnemyCard.tsx
 *      returns null for anything else and use-combat-actions.ts only collects
 *      'monster' rows as targets, so 'enemy' would satisfy the constraint and
 *      still leave the combatant untargetable -- a quieter bug than the 500.
 *
 * Server code branches only on `=== 'player'`, so 'monster' is inert downstream.
 */
export type ParticipantType = 'player' | 'npc' | 'monster';

/** What identifies a combatant, as far as its participant_type is concerned. */
export interface ParticipantIdentity {
  characterId?: string | null;
  npcId?: string | null;
}

/**
 * Derive a combatant's participant_type from what identifies it.
 *
 * A combatant seated through combat entry is hostile by construction, so the
 * fallback is 'monster'. Callers that carry a monsterId need not pass it: it
 * resolves to the same 'monster' the fallback already returns.
 */
export function resolveParticipantType(identity: ParticipantIdentity): ParticipantType {
  if (identity.characterId) return 'player';
  if (identity.npcId) return 'npc';
  return 'monster';
}
