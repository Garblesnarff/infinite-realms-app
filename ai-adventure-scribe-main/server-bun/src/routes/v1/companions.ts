import { verifySessionOwnership } from './combat/helpers.js';
import { createCompanionRoutes } from './companion-routes.js';
import { requireAuth } from '../../middleware/auth.js';
import { CompanionService, mapCompanion } from '../../services/session/companion-service.js';

export const companionRoutes = createCompanionRoutes({
  auth: requireAuth,
  verifyOwnership: verifySessionOwnership,
  service: CompanionService,
  mapCompanion,
});
