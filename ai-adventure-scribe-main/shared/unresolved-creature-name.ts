/**
 * The labels that stand in for a creature nobody named. Shared so the server (which must never
 * seat one, #2532) and the entry popup (which must never show one) read one list.
 */
export const UNKNOWN_CREATURE = 'Unknown creature';

const GENERIC_NPC_NAMES = new Set([
  'creature',
  'enemy',
  'hostile creature',
  'monster',
  'npc',
  'player',
  'unknown creature',
]);

/** Model-generated seat labels are not NPC identities. */
export function isUnresolvedNpcName(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  return (
    !normalized ||
    GENERIC_NPC_NAMES.has(normalized) ||
    /^(?:player|npc|enemy|monster|creature|hostile creature|unknown creature)(?:\s+\d+)+$/.test(
      normalized,
    )
  );
}
