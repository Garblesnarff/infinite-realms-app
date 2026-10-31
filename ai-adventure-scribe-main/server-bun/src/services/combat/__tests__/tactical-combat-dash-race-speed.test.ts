/**
 * #1251: the combat movement budget reads the character's speed, and Dash
 * doubles it. The seating fix lands the race-derived speed on the participant;
 * the board copies it into speedFeet/movementRemaining, and Dash adds one
 * speedFeet. This pins the board half with a gnome-speed budget: 25 ft seated,
 * 25 ft of movement, 50 ft after Dash.
 *
 * The map store and room broadcast are mocked, as in
 * tactical-combat-lifecycle-display-name.test.ts; nothing here touches a database.
 * Participants are shaped like `CombatEncounterService.getCombatState` rows.
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

const { createTacticalCombatMap, grantTacticalDash } =
  await import('../tactical-combat-lifecycle.js');

const gnome = {
  id: 'gnome-1',
  name: 'Oriel Tansfield',
  participantType: 'player',
  speed: 25,
} as never;

describe('a gnome-speed board (#1251)', () => {
  it('seats a 25 ft budget and Dash doubles it to 50 ft', async () => {
    const map = await createTacticalCombatMap('session-dash-1251', [gnome], {
      environment: 'ruins',
      seed: 7,
    } as never);
    const entity = map.entities.find((candidate) => candidate.id === 'gnome-1');
    expect(entity?.speedFeet).toBe(25);
    expect(entity?.movementRemaining).toBe(25);

    const dashed = (await grantTacticalDash('session-dash-1251', 'gnome-1')) as TacticalMap & {
      movementGainedFeet: number;
      engineRows: Array<{ kind: string; movementGainedFeet: number }>;
    };
    expect(dashed.movementGainedFeet).toBe(25);
    expect(dashed.engineRows).toEqual([{ kind: 'dash', movementGainedFeet: 25 }]);
    const after = dashed.entities.find((candidate) => candidate.id === 'gnome-1');
    expect(after?.movementRemaining).toBe(50);
  });
});
