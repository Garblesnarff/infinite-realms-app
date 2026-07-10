import { checkLineOfSight, getCover, getDistance } from './engine';
import type { MapEntity, TacticalMap } from './types';

const isEnemy = (a: MapEntity, b: MapEntity) => (a.type === 'pc') !== (b.type === 'pc');
/** Every spatial fact the DM needs; geometry must never be inferred from prose. */
export function buildTacticalDigest(map: TacticalMap, forEntityId?: string): string {
  const subjects = forEntityId ? map.entities.filter(e => e.id === forEntityId) : map.entities;
  return subjects.filter(e => e.isLiving !== false).map(entity => {
    const enemies = map.entities.filter(other => other.isLiving !== false && isEnemy(entity, other)).map(enemy => `${enemy.id}:${getDistance(entity, enemy)}ft/${checkLineOfSight(map, entity.id, enemy.id) ? 'LoS' : 'noLoS'}/c${getCover(map, entity.id, enemy.id)}/${getDistance(entity, enemy) <= 5 ? 'melee' : 'range'}`).join(',');
    return `${entity.id}@${entity.x},${entity.y} mv${entity.movementRemaining}/${entity.speedFeet} vs[${enemies || '-'}]`;
  }).join('\n');
}
