import type { Cell, TacticalMap } from './types';

const terrainGlyph: Record<Cell['terrain'], string> = { floor: '.', wall: '#', door_closed: '+', door_open: '/', difficult: '~', water: '≈', pit: 'O', obscured: '?' };
/** Compact, row-oriented text intentionally suitable for the DM's structured prompt. */
export function mapToAscii(map: TacticalMap): string {
  const occupants = new Map<string, string>();
  map.entities.forEach((entity, i) => { const glyph = entity.type === 'pc' ? 'P' : entity.type === 'monster' ? 'M' : entity.type === 'npc' ? 'N' : 'X'; for (let y = entity.y; y < entity.y + ({tiny:1,small:1,medium:1,large:2,huge:3,gargantuan:4}[entity.size]); y++) for (let x = entity.x; x < entity.x + ({tiny:1,small:1,medium:1,large:2,huge:3,gargantuan:4}[entity.size]); x++) occupants.set(`${x},${y}`, glyph); });
  const rows = map.cells.map((row, y) => row.map((cell, x) => occupants.get(`${x},${y}`) ?? terrainGlyph[cell.terrain]).join(''));
  return `MAP ${map.width}x${map.height} (.:floor #:wall +:closed-door /:open-door ~:difficult ≈:water O:pit ?:obscured P:pc M:monster N:npc X:object)\n${rows.map((r, i) => `${String(i).padStart(2, '0')} ${r}`).join('\n')}`;
}
