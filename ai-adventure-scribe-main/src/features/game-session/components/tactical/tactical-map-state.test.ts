import { describe, expect, it } from 'vitest';

import { applyTacticalDelta, type TacticalMap } from './tactical-map-state';

const map = (): TacticalMap => ({
  id: 'map',
  sessionId: 'session',
  width: 2,
  height: 2,
  round: 1,
  sceneDescription: 'room',
  cells: Array.from({ length: 2 }, () =>
    Array.from({ length: 2 }, () => ({
      terrain: 'floor',
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: 'pc',
      x: 0,
      y: 0,
      size: 'medium',
      type: 'pc',
      speedFeet: 30,
      movementRemaining: 30,
      name: 'Ada',
    },
  ],
});

describe('applyTacticalDelta', () => {
  it('mounts and destroys maps', () => {
    expect(applyTacticalDelta(null, { type: 'map_created', map: map() })).toEqual(map());
    expect(applyTacticalDelta(map(), { type: 'map_destroyed' })).toBeNull();
  });
  it('moves an entity to the authoritative path destination', () => {
    expect(
      applyTacticalDelta(map(), {
        type: 'entity_moved',
        entityId: 'pc',
        path: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
      })?.entities[0],
    ).toMatchObject({ x: 1, y: 1 });
  });
  it('renders a forced move from the authoritative delta just like an ordinary move', () => {
    expect(
      applyTacticalDelta(map(), {
        type: 'entity_moved',
        entityId: 'pc',
        path: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
        forced: true,
        mode: 'shove',
      })?.entities[0],
    ).toMatchObject({ x: 0, y: 1 });
  });
  it('applies a cell delta without mutating adjacent cells', () => {
    const next = applyTacticalDelta(map(), {
      type: 'cell_updated',
      x: 1,
      y: 0,
      changes: { terrain: 'door_open', blocksMovement: false },
    })!;
    expect(next.cells[0][1].terrain).toBe('door_open');
    expect(next.cells[1][1].terrain).toBe('floor');
  });
});
