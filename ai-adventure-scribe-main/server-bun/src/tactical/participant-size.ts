import monsterCatalog from '../../../src/data/srd/monsters.json' with { type: 'json' };

type Participant = { id?: string; name: string; participantType: string; speed?: number };
type MonsterCatalogEntry = { id: string; name: string; size?: string };
type EntitySize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gargantuan';
const tacticalSizes = new Set<EntitySize>(['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan']);

/**
 * SRD catalog lookup is deliberately name/id based because initiative rows retain those, not a map-only ID.
 *
 * `resolvedSize` wins when present: a structured DM combat start names enemies freely
 * ("Aggressive Patron" for `srd:bandit`), so the name-based catalog lookup below cannot
 * find them and the size must come from the id resolved at start time.
 */
export function tacticalSizeForParticipant(
  participant: Participant,
  resolvedSize?: EntitySize,
): EntitySize {
  if (participant.participantType === 'player') return 'medium';
  if (resolvedSize && tacticalSizes.has(resolvedSize)) return resolvedSize;
  const monster = (monsterCatalog as MonsterCatalogEntry[]).find((entry) => entry.name.toLowerCase() === participant.name.toLowerCase() || entry.id.toLowerCase() === participant.name.toLowerCase());
  const size = monster?.size?.toLowerCase();
  return size && tacticalSizes.has(size as EntitySize) ? size as EntitySize : 'medium';
}
