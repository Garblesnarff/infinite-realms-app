import { checkLineOfSight, getCover, getDistance } from './engine';
import { entitySlug, resolveEntityRef } from './identity';

import type { MapEntity, TacticalMap } from './types';

const isEnemy = (a: MapEntity, b: MapEntity) => (a.type === 'pc') !== (b.type === 'pc');
/**
 * Every spatial fact the DM needs; geometry must never be inferred from prose.
 *
 * Entities are addressed by slug, never by UUID: the model has to copy these tokens back
 * into `map_actions`, and a slug is both easier to echo correctly and far cheaper in tokens.
 */
export function buildTacticalDigest(map: TacticalMap, forEntityId?: string): string {
  // Every living entity is always rendered. Narrowing the digest to the active entity used to
  // look like a token saving, but it left the spatial-contract validator with a one-entity
  // board: it could never resolve an attack's target, so it never fired once. Whose turn it
  // is travels as a separate ACTIVE line instead.
  const active = forEntityId ? resolveEntityRef(map.entities, forEntityId) : null;
  const lines = map.entities
    .filter((e) => e.isLiving !== false)
    .map((entity) => {
      const enemies = map.entities
        .filter((other) => other.isLiving !== false && isEnemy(entity, other))
        .map(
          (enemy) =>
            `${entitySlug(enemy)}:${getDistance(entity, enemy)}ft/${checkLineOfSight(map, entity.id, enemy.id) ? 'LoS' : 'noLoS'}/c${getCover(map, entity.id, enemy.id)}/${getDistance(entity, enemy) <= 5 ? 'melee' : 'range'}`,
        )
        .join(',');
      // The name is carried alongside the slug so prose the DM writes ("Void-Maw lunges") can be
      // tied back to the exact entity the geometry belongs to. It is dropped when the slug
      // already says the same thing, which is the common case.
      const slug = entitySlug(entity);
      const name = entity.name && entity.name !== slug ? `|${entity.name}` : '';
      return `${slug}${name}@${entity.x},${entity.y} mv${entity.movementRemaining}/${entity.speedFeet} vs[${enemies || '-'}]`;
    });
  return active ? [`ACTIVE ${entitySlug(active)}`, ...lines].join('\n') : lines.join('\n');
}
