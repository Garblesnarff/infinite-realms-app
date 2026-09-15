import { Elysia } from 'elysia';

import { actionRoutes } from './actions.js';
import { advanceNpcTurnRoutes } from './advance-npc-turns.js';
import { entryRoutes } from './entry.js';
import { initiativeRoutes } from './initiative.js';
import { intentRoutes } from './intents.js';
import { pendingIntentRoutes } from './pending-intent.js';
import { persistenceRoutes } from './persistence.js';
import { statusRoutes } from './status.js';

// damage.ts (direct damage/heal/temp-hp/death-save endpoints) was removed in the
// 2026-07-22 dead-code sweep — zero frontend/e2e/test callers. Combat damage/healing is
// applied server-side via intent resolution; the persistence route only records the
// already-calculated damage log for the legacy browser integrator.
export const combatRoutes = new Elysia({ prefix: '/v1/combat' })
  .use(entryRoutes)
  .use(advanceNpcTurnRoutes)
  .use(initiativeRoutes)
  .use(actionRoutes)
  .use(intentRoutes)
  .use(pendingIntentRoutes)
  .use(statusRoutes)
  .use(persistenceRoutes);
