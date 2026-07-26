/**
 * Loadout route.
 *
 * One endpoint, deliberately its own module rather than another handler in `inventory.ts`:
 * the DM prompt builder is its only consumer, and what it returns is combat-engine data
 * (weapon profiles resolved through `listEquippedWeaponProfiles`) rather than the inventory
 * CRUD surface.
 *
 * @module server/routes/v1/loadout
 */
import { Elysia } from 'elysia';

import { NotFoundError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { getEquippedLoadout } from '../../services/combat/equipped-loadout.js';

import type { EquippedLoadout } from '../../services/combat/equipped-loadout.js';

export const loadoutRoutes = new Elysia({ prefix: '/v1/characters' })
  .use(requireAuth)
  .get(
    '/:id/loadout',
    async ({ params, set, user }): Promise<EquippedLoadout | { error: string }> => {
      try {
        // Ownership is verified inside getEquippedLoadout, which masks a character belonging to
        // someone else as missing rather than admitting it exists.
        return await getEquippedLoadout(params.id, (user as { userId: string }).userId);
      } catch (error) {
        if (error instanceof NotFoundError) {
          set.status = 404;
          return { error: 'Character not found' };
        }
        logger.error({ msg: 'LOADOUT_GET error', error });
        set.status = 500;
        return { error: 'Failed to fetch loadout' };
      }
    },
  );
