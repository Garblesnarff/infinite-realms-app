import { Elysia } from 'elysia';

import { actionRoutes } from './actions.js';
import { damageRoutes } from './damage.js';
import { initiativeRoutes } from './initiative.js';
import { statusRoutes } from './status.js';
import { intentRoutes } from './intents.js';

export const combatRoutes = new Elysia({ prefix: '/v1/combat' })
  .use(initiativeRoutes)
  .use(actionRoutes)
  .use(intentRoutes)
  .use(damageRoutes)
  .use(statusRoutes);
