import { generateMap, validateGeneratedMap } from '../server-bun/src/tactical/generator';

import type { SceneEnvironment, SceneSize } from '../server-bun/src/tactical/types';

const environments: SceneEnvironment[] = [
  'dungeon_room',
  'cave',
  'tavern',
  'forest_clearing',
  'road',
  'ruins',
  'ship_deck',
  'open_field',
  'corridor',
];
const sizes: SceneSize[] = ['small', 'medium', 'large'];
let maps = 0,
  elements = 0;
for (const environment of environments)
  for (const size of sizes)
    for (let seed = 1; seed <= 50; seed++) {
      const map = generateMap({ environment, size, seed });
      const result = validateGeneratedMap(map);
      if (!result.connected || result.tacticalElements < 2 || !result.entitiesValid)
        throw new Error(`${environment}/${size}/${seed} failed: ${JSON.stringify(result)}`);
      maps++;
      elements += result.tacticalElements;
    }
console.log(
  `Validated ${maps} tactical maps; average tactical cells ${(elements / maps).toFixed(1)}.`,
);
