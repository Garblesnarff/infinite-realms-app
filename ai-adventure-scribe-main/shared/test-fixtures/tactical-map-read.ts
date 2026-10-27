/**
 * The body `GET /v1/sessions/:id/tactical-map` returns while a map is active (#1185).
 *
 * The route returns the map itself, not `{ map }`; only the no-map read is wrapped
 * (`{ map: null }`). The server test posts the read through the real route and checks it
 * returns exactly this; the client test feeds exactly this to `actorMovementRemaining`.
 */
export const TACTICAL_MAP_SESSION_ID = '11111111-2222-4333-8444-555555555555';
export const TACTICAL_MAP_WIZARD_ID = 'wizard-participant-1';

export const activeTacticalMapRead = () => ({
  id: 'map-1185',
  sessionId: TACTICAL_MAP_SESSION_ID,
  width: 3,
  height: 3,
  round: 1,
  sceneDescription: 'collapsed quarry',
  cells: Array.from({ length: 3 }, () =>
    Array.from({ length: 3 }, () => ({
      terrain: 'floor' as const,
      blocksMovement: false,
      blocksSight: false,
      cover: 0 as const,
      elevation: 0,
    })),
  ),
  entities: [
    {
      id: TACTICAL_MAP_WIZARD_ID,
      slug: 'wizard',
      name: 'Adda',
      x: 0,
      y: 0,
      size: 'medium' as const,
      type: 'pc' as const,
      speedFeet: 30,
      movementRemaining: 30,
    },
    {
      id: 'rubble-sentinel-1',
      slug: 'rubble-sentinel',
      name: 'Rubble Sentinel',
      x: 2,
      y: 2,
      size: 'medium' as const,
      type: 'monster' as const,
      speedFeet: 30,
      movementRemaining: 30,
    },
  ],
});
