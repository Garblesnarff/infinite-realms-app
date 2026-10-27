import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  TACTICAL_MAP_SESSION_ID,
  TACTICAL_MAP_WIZARD_ID,
  activeTacticalMapRead,
} from '../../../../shared/test-fixtures/tactical-map-read';
import { actorMovementRemaining } from '../player-movement-remaining';

/**
 * #1185: every cast auto-ended the turn although the caster still had movement. The route
 * returns the active map itself (pinned by server-bun tactical-map-read-shape.test.ts against
 * the same fixture), and this read only looked under `.map`, so it returned null for every
 * active map and the turn settled as if movement were spent.
 */
function stubTacticalMapRead(body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => body,
  } as Response);
}

describe('actorMovementRemaining (#1185)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads the movement left from the body the route returns for an active map', async () => {
    stubTacticalMapRead(activeTacticalMapRead());

    await expect(
      actorMovementRemaining(TACTICAL_MAP_SESSION_ID, TACTICAL_MAP_WIZARD_ID),
    ).resolves.toBe(30);
  });

  it('reads a spent board as 0', async () => {
    const map = activeTacticalMapRead();
    map.entities[0].movementRemaining = 0;
    stubTacticalMapRead(map);

    await expect(
      actorMovementRemaining(TACTICAL_MAP_SESSION_ID, TACTICAL_MAP_WIZARD_ID),
    ).resolves.toBe(0);
  });

  it('returns null for the no-map read', async () => {
    stubTacticalMapRead({ map: null });

    await expect(
      actorMovementRemaining(TACTICAL_MAP_SESSION_ID, TACTICAL_MAP_WIZARD_ID),
    ).resolves.toBeNull();
  });

  it('returns null when the actor is not on the board', async () => {
    stubTacticalMapRead(activeTacticalMapRead());

    await expect(
      actorMovementRemaining(TACTICAL_MAP_SESSION_ID, 'someone-else'),
    ).resolves.toBeNull();
  });
});
