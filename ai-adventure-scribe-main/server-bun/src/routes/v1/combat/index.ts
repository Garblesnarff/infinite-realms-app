import { Elysia } from 'elysia';
import { initiativeRoutes } from './initiative.js';
import { actionRoutes } from './actions.js';
import { damageRoutes } from './damage.js';
import { statusRoutes } from './status.js';

export const combatRoutes = new Elysia({ prefix: '/v1/combat' })
  .use(initiativeRoutes)
  .use(actionRoutes)
  .use(damageRoutes)
  .use(statusRoutes);
