/**
 * The board a fight is played on must carry the name the cards show (#876).
 *
 * `createTacticalCombatMap` converts the seated participants into the persisted tactical
 * map, and every later name resolution reads that map back — the session entity index,
 * the AoE cast service, tactical dispatch. The seating label ("The Pale Shape 1") and
 * the bestiary heading the result cards print ("The Thing Below (Avatar) 1") both belong
 * on the entity, or a target named by the card can never resolve off the board.
 *
 * Participants are shaped like `CombatEncounterService.getCombatState` rows: the heading
 * lives on the stored attack profile (`monsterAttack.displayName`, written at seating by
 * `assignBestiaryDisplayNames`), not in a column.
 */
import { describe, expect, it, mock } from 'bun:test';

import type { TacticalMap } from '../../../tactical/types.js';

let savedMap: TacticalMap | null = null;

mock.module('../tactical-map-store.js', () => ({
  loadActiveTacticalMap: async (): Promise<TacticalMap | null> => savedMap,
  loadLatestTacticalMapRow: async (): Promise<null> => null,
  saveTacticalMap: async (map: TacticalMap): Promise<void> => {
    savedMap = map;
  },
  deactivateTacticalMap: async (): Promise<void> => {},
}));
mock.module('../../collaboration/room-manager.js', () => ({
  broadcastToRoom: (): void => {},
}));

const { createTacticalCombatMap } = await import('../tactical-combat-lifecycle.js');
const { loadSessionEntityIndex } = await import('../session-entity-index.js');

const avatar = (seat: number): Record<string, unknown> => ({
  id: `avatar-${seat}`,
  name: `The Pale Shape ${seat}`,
  participantType: 'monster',
  speed: 30,
  monsterAttack: { displayName: `The Thing Below (Avatar) ${seat}`, attacks: [] },
});

const participants = [
  { id: 'rook', name: 'Rook', participantType: 'player', speed: 30 },
  avatar(1),
  avatar(2),
] as never;

describe('the tactical board for a renamed creature (#876)', () => {
  it('stamps the card name onto the map entity beside the seating label', async () => {
    const map = await createTacticalCombatMap('session-876', participants, {
      environment: 'ruins',
      seed: 7,
    } as never);
    const first = map.entities.find((entity) => entity.id === 'avatar-1');
    expect(first?.name).toBe('The Pale Shape 1');
    expect(first?.displayName).toBe('The Thing Below (Avatar) 1');
    const second = map.entities.find((entity) => entity.id === 'avatar-2');
    expect(second?.displayName).toBe('The Thing Below (Avatar) 2');
    const player = map.entities.find((entity) => entity.id === 'rook');
    expect(player?.displayName).toBeUndefined();
  });

  it('resolves the card name through the session entity index, and keeps the label', async () => {
    await createTacticalCombatMap('session-876', participants, {
      environment: 'ruins',
      seed: 7,
    } as never);
    const index = await loadSessionEntityIndex('session-876');
    expect(index.resolve('The Thing Below (Avatar) 1')).toBe('avatar-1');
    expect(index.resolve('The Thing Below (Avatar) 2')).toBe('avatar-2');
    expect(index.resolve('The Pale Shape 1')).toBe('avatar-1');
    // The unnumbered heading names two seats: the index hands the token back unresolved.
    expect(index.resolve('The Thing Below (Avatar)')).toBe('The Thing Below (Avatar)');
  });
});
