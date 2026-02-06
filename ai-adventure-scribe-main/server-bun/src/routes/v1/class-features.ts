/**
 * Class Features Routes (Elysia/Bun)
 *
 * REST endpoints for D&D 5E class features system:
 * - Feature library queries
 * - Character feature management
 * - Subclass management
 * - Feature usage tracking
 *
 * Ported from /server/src/routes/v1/class-features.ts
 */

import { Elysia } from 'elysia';
import { authenticateRequest } from '../../lib/auth.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { verifySessionOwnership } from './combat/helpers.js';

// Import service from Bun server
import { CharacterService } from '../../services/character-service.js';
import { ClassFeaturesService } from '../../services/class-features-service.js';

/**
 * Helper to verify character ownership
 */
async function verifyCharacterOwnership(
  characterId: string,
  userId: string
): Promise<{ success: true } | { success: false; status: number; error: string }> {
  const character = await CharacterService.getById(characterId, userId);
  if (!character) {
    return { success: false, status: 404, error: 'Character not found' };
  }
  return { success: true };
}

function mapClassFeaturesError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set: any,
  error: unknown,
  fallbackMessage: string,
  notFoundMessage: string = 'Not found'
) {
  if (error instanceof AppError) {
    if (error.statusCode === 404) {
      set.status = 404;
      return { error: notFoundMessage };
    }

    set.status = error.statusCode;
    if (error.statusCode >= 500) {
      return { error: fallbackMessage };
    }

    return { error: error.message };
  }

  set.status = 500;
  return { error: fallbackMessage };
}

export const classFeaturesRoutes = new Elysia({ prefix: '/v1/class-features' })

  /**
   * GET /v1/class-features
   * Get features from the library
   */
  .get('/', async ({ request, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const { className, subclass, level } = query as {
        className?: string;
        subclass?: string;
        level?: string;
      };

      const features = await ClassFeaturesService.getFeaturesLibrary({
        className,
        subclass,
        level: level ? parseInt(level) : undefined,
      });

      return { features };
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_LIBRARY error', error });
      return mapClassFeaturesError(set, error, 'Failed to get features');
    }
  })

  /**
   * GET /v1/class-features/subclasses/:className
   * Get available subclasses for a class
   */
  .get('/subclasses/:className', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const result = ClassFeaturesService.getAvailableSubclasses(params.className);
      return result;
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_SUBCLASSES error', error });
      return mapClassFeaturesError(set, error, 'Failed to get subclasses');
    }
  })

  /**
   * GET /v1/class-features/characters/:id/features
   * Get all features for a character
   */
  .get('/characters/:id/features', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const result = await ClassFeaturesService.getCharacterFeaturesWithUsage(params.id, user.userId);
      return result;
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_CHARACTER error', error });
      return mapClassFeaturesError(set, error, 'Failed to get character features', 'Character not found');
    }
  })

  /**
   * POST /v1/class-features/characters/:id/features/:featureId/grant
   * Grant a feature to a character
   */
  .post('/characters/:id/features/:featureId/grant', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { acquiredAtLevel } = body as { acquiredAtLevel: number };

      if (!acquiredAtLevel || acquiredAtLevel < 1 || acquiredAtLevel > 20) {
        set.status = 400;
        return { error: 'Invalid level (must be 1-20)' };
      }

      const result = await ClassFeaturesService.grantFeature({
        characterId: params.id,
        featureId: params.featureId,
        acquiredAtLevel,
      }, user.userId);

      set.status = 201;
      return result;
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_GRANT error', error });
      return mapClassFeaturesError(set, error, 'Failed to grant feature', 'Character not found');
    }
  })

  /**
   * POST /v1/class-features/characters/:id/features/:featureId/use
   * Use a feature
   */
  .post('/characters/:id/features/:featureId/use', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { context, sessionId } = body as {
        context?: string;
        sessionId?: string;
      };

      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, user.userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      const result = await ClassFeaturesService.useFeature({
        characterId: params.id,
        featureId: params.featureId,
        context,
        sessionId,
      }, user.userId);

      if (!result.success) {
        set.status = 400;
        return result;
      }

      return result;
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_USE error', error });
      return mapClassFeaturesError(set, error, 'Failed to use feature', 'Character not found');
    }
  })

  /**
   * POST /v1/class-features/characters/:id/features/restore
   * Restore features after rest
   */
  .post('/characters/:id/features/restore', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { restType } = body as { restType: 'short' | 'long' };

      if (!restType || (restType !== 'short' && restType !== 'long')) {
        set.status = 400;
        return { error: 'Invalid rest type (must be "short" or "long")' };
      }

      const result = await ClassFeaturesService.restoreFeatures({
        characterId: params.id,
        restType,
      }, user.userId);

      return result;
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_RESTORE error', error });
      return mapClassFeaturesError(set, error, 'Failed to restore features', 'Character not found');
    }
  })

  /**
   * POST /v1/class-features/characters/:id/subclass
   * Set character's subclass
   */
  .post('/characters/:id/subclass', async ({ request, params, body, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { className, subclassName, level } = body as {
        className: string;
        subclassName: string;
        level: number;
      };

      if (!className || !subclassName || !level) {
        set.status = 400;
        return { error: 'Missing required fields: className, subclassName, level' };
      }

      if (level < 1 || level > 20) {
        set.status = 400;
        return { error: 'Invalid level (must be 1-20)' };
      }

      const result = await ClassFeaturesService.setSubclass({
        characterId: params.id,
        className,
        subclassName,
        level,
      }, user.userId);

      set.status = 201;
      return result;
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_SET_SUBCLASS error', error });
      return mapClassFeaturesError(set, error, 'Failed to set subclass', 'Character not found');
    }
  })

  /**
   * GET /v1/class-features/characters/:id/subclass/:className
   * Get character's subclass for a class
   */
  .get('/characters/:id/subclass/:className', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const subclass = await ClassFeaturesService.getCharacterSubclass(params.id, params.className, user.userId);

      if (!subclass) {
        set.status = 404;
        return { error: 'Subclass not found for this class' };
      }

      return { subclass };
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_GET_SUBCLASS error', error });
      return mapClassFeaturesError(set, error, 'Failed to get subclass', 'Character not found');
    }
  })

  /**
   * GET /v1/class-features/characters/:id/features/history
   * Get feature usage history
   */
  .get('/characters/:id/features/history', async ({ request, params, query, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const ownership = await verifyCharacterOwnership(params.id, user.userId);
      if (ownership.success === false) {
        set.status = ownership.status;
        return { error: ownership.error };
      }

      const { featureId, sessionId, limit } = query as {
        featureId?: string;
        sessionId?: string;
        limit?: string;
      };

      if (sessionId) {
        const verification = await verifySessionOwnership(sessionId, user.userId);
        if (!verification.success) {
          set.status = verification.error!.status;
          return { error: verification.error!.message };
        }
      }

      const history = await ClassFeaturesService.getFeatureUsageHistory({
        characterId: params.id,
        featureId,
        sessionId,
        limit: limit ? parseInt(limit) : 50,
      }, user.userId);

      return { history };
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_HISTORY error', error });
      return mapClassFeaturesError(set, error, 'Failed to get feature history', 'Character not found');
    }
  })

  /**
   * GET /v1/class-features/:featureId
   * Get a specific feature by ID
   */
  .get('/:featureId', async ({ request, params, set }) => {
    const { user, error: authError } = await authenticateRequest(request);
    if (authError || !user) {
      set.status = 401;
      return { error: authError || 'Unauthorized' };
    }

    try {
      const feature = await ClassFeaturesService.getFeatureById(params.featureId);

      if (!feature) {
        set.status = 404;
        return { error: 'Feature not found' };
      }

      return { feature };
    } catch (error) {
      logger.error({ msg: 'CLASS_FEATURES_GET error', error });
      return mapClassFeaturesError(set, error, 'Failed to get feature', 'Feature not found');
    }
  });
