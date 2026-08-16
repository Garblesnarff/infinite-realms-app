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
 *
 * @deprecated No frontend callers as of 2026-07-08; retained for built-before-wired feature APIs.
 */

import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { AppError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { CharacterService } from '../../services/character-service.js';
import { parseOptionalBoundedInteger } from '../../services/class-features/query-integers.js';
import { ClassFeaturesService } from '../../services/class-features-service.js';

const characterIdParams = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
});

const featureIdParams = t.Object({
  featureId: t.String({ minLength: 1, maxLength: 255 }),
});

const characterFeatureParams = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
  featureId: t.String({ minLength: 1, maxLength: 255 }),
});

const classNameParams = t.Object({
  className: t.String({ minLength: 1, maxLength: 100 }),
});

const characterClassParams = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
  className: t.String({ minLength: 1, maxLength: 100 }),
});

const featuresLibraryQuery = t.Object({
  className: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  subclass: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  level: t.Optional(t.String({ minLength: 1, maxLength: 2, pattern: '^(?:[1-9]|1[0-9]|20)$' })),
});

const grantFeatureSchema = t.Object({
  acquiredAtLevel: t.Number({ minimum: 1, maximum: 20 }),
});

const useFeatureSchema = t.Object({
  context: t.Optional(t.String({ maxLength: 10_000 })),
  sessionId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
});

const restoreFeaturesSchema = t.Object({
  restType: t.Union([t.Literal('short'), t.Literal('long')]),
});

const setSubclassSchema = t.Object({
  className: t.String({ minLength: 1, maxLength: 100 }),
  subclassName: t.String({ minLength: 1, maxLength: 100 }),
  level: t.Number({ minimum: 1, maximum: 20 }),
});

const featureHistoryQuery = t.Object({
  featureId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  sessionId: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
  limit: t.Optional(
    t.String({ minLength: 1, maxLength: 4, pattern: '^(?:[1-9][0-9]{0,2}|1000)$' }),
  ),
});

/**
 * Helper to map and mask error responses
 */
function mapClassFeaturesError(
  set: { status?: number | string },
  error: unknown,
  fallbackMessage: string,
  notFoundMessage: string = 'Not found',
): { error: string } {
  if (error instanceof AppError) {
    if (error.statusCode === 404 || error.statusCode === 403) {
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
  .use(requireAuth)
  /**
   * Centralized character ownership verification
   */
  .onBeforeHandle(async ({ user, params, set }) => {
    if (params.id) {
      // 🛡️ Sentinel: Use CharacterService.getById which verifies dual-ownership (userId/ownerId)
      // and masks existence by returning null for unauthorized access.
      const character = await CharacterService.getById(params.id, user.userId);
      if (!character) {
        set.status = 404;
        return { error: 'Character not found' };
      }
    }
  })

  /**
   * GET /v1/class-features
   * Get features from the library
   */
  .get(
    '/',
    async ({ query, set }) => {
      try {
        const { className, subclass, level } = query;
        const parsedLevel = parseOptionalBoundedInteger(level, 1, 20);

        if (parsedLevel === null) {
          set.status = 400;
          return { error: 'level must be between 1 and 20' };
        }

        const features = await ClassFeaturesService.getFeaturesLibrary({
          className,
          subclass,
          level: parsedLevel,
        });

        return { features };
      } catch (error) {
        logger.error({ msg: 'CLASS_FEATURES_LIBRARY error', error });
        return mapClassFeaturesError(set, error, 'Failed to get features');
      }
    },
    { query: featuresLibraryQuery },
  )

  /**
   * GET /v1/class-features/subclasses/:className
   * Get available subclasses for a class
   */
  .get(
    '/subclasses/:className',
    async ({ params, set }) => {
      try {
        const result = ClassFeaturesService.getAvailableSubclasses(params.className);
        return result;
      } catch (error) {
        logger.error({ msg: 'CLASS_FEATURES_SUBCLASSES error', error });
        return mapClassFeaturesError(set, error, 'Failed to get subclasses');
      }
    },
    { params: classNameParams },
  )

  /**
   * GET /v1/class-features/characters/:id/features
   * Get all features for a character
   */
  .get(
    '/characters/:id/features',
    async ({ params, set, user }) => {
      try {
        const result = await ClassFeaturesService.getCharacterFeaturesWithUsage(
          params.id,
          user!.userId,
        );
        return result;
      } catch (error) {
        logger.error({ msg: 'CLASS_FEATURES_CHARACTER error', error });
        return mapClassFeaturesError(
          set,
          error,
          'Failed to get character features',
          'Character not found',
        );
      }
    },
    { params: characterIdParams },
  )

  /**
   * POST /v1/class-features/characters/:id/features/:featureId/grant
   * Grant a feature to a character
   */
  .post(
    '/characters/:id/features/:featureId/grant',
    async ({ params, body, set, user }) => {
      try {
        const { acquiredAtLevel } = body;

        if (!acquiredAtLevel || acquiredAtLevel < 1 || acquiredAtLevel > 20) {
          set.status = 400;
          return { error: 'Invalid level (must be 1-20)' };
        }

        const result = await ClassFeaturesService.grantFeature({
          characterId: params.id,
          featureId: params.featureId,
          acquiredAtLevel,
          userId: user!.userId,
        });

        set.status = 201;
        return result;
      } catch (error) {
        logger.error({ msg: 'CLASS_FEATURES_GRANT error', error });
        return mapClassFeaturesError(set, error, 'Failed to grant feature', 'Character not found');
      }
    },
    { params: characterFeatureParams, body: grantFeatureSchema },
  )

  /**
   * POST /v1/class-features/characters/:id/features/:featureId/use
   * Use a feature
   */
  .post(
    '/characters/:id/features/:featureId/use',
    async ({ params, body, set, user }) => {
      try {
        const { context, sessionId } = body;

        if (sessionId) {
          const verification = await verifySessionOwnership(sessionId, user!.userId);
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
          userId: user!.userId,
        });

        if (!result.success) {
          set.status = 400;
          return result;
        }

        return result;
      } catch (error) {
        logger.error({ msg: 'CLASS_FEATURES_USE error', error });
        return mapClassFeaturesError(set, error, 'Failed to use feature', 'Character not found');
      }
    },
    { params: characterFeatureParams, body: useFeatureSchema },
  )

  /**
   * POST /v1/class-features/characters/:id/features/restore
   * Restore features after rest
   */
  .post(
    '/characters/:id/features/restore',
    async ({ params, body, set, user }) => {
      try {
        const { restType } = body;

        if (!restType || (restType !== 'short' && restType !== 'long')) {
          set.status = 400;
          return { error: 'Invalid rest type (must be "short" or "long")' };
        }

        const result = await ClassFeaturesService.restoreFeatures({
          characterId: params.id,
          restType,
          userId: user!.userId,
        });

        return result;
      } catch (error) {
        logger.error({ msg: 'CLASS_FEATURES_RESTORE error', error });
        return mapClassFeaturesError(
          set,
          error,
          'Failed to restore features',
          'Character not found',
        );
      }
    },
    { params: characterIdParams, body: restoreFeaturesSchema },
  )

  /**
   * POST /v1/class-features/characters/:id/subclass
   * Set character's subclass
   */
  .post(
    '/characters/:id/subclass',
    async ({ params, body, set, user }) => {
      try {
        const { className, subclassName, level } = body;

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
          userId: user!.userId,
        });

        set.status = 201;
        return result;
      } catch (error) {
        logger.error({ msg: 'CLASS_FEATURES_SET_SUBCLASS error', error });
        return mapClassFeaturesError(set, error, 'Failed to set subclass', 'Character not found');
      }
    },
    { params: characterIdParams, body: setSubclassSchema },
  )

  /**
   * GET /v1/class-features/characters/:id/subclass/:className
   * Get character's subclass for a class
   */
  .get(
    '/characters/:id/subclass/:className',
    async ({ params, set, user }) => {
      try {
        const subclass = await ClassFeaturesService.getCharacterSubclass(
          params.id,
          params.className,
          user!.userId,
        );

        if (!subclass) {
          set.status = 404;
          return { error: 'Subclass not found for this class' };
        }

        return { subclass };
      } catch (error) {
        logger.error({ msg: 'CLASS_FEATURES_GET_SUBCLASS error', error });
        return mapClassFeaturesError(set, error, 'Failed to get subclass', 'Character not found');
      }
    },
    { params: characterClassParams },
  )

  /**
   * GET /v1/class-features/characters/:id/features/history
   * Get feature usage history
   */
  .get(
    '/characters/:id/features/history',
    async ({ params, query, set, user }) => {
      try {
        const { featureId, sessionId, limit } = query;
        const parsedLimit = parseOptionalBoundedInteger(limit, 1, 1_000);

        if (parsedLimit === null) {
          set.status = 400;
          return { error: 'limit must be between 1 and 1000' };
        }

        if (sessionId) {
          const verification = await verifySessionOwnership(sessionId, user!.userId);
          if (!verification.success) {
            set.status = verification.error!.status;
            return { error: verification.error!.message };
          }
        }

        const history = await ClassFeaturesService.getFeatureUsageHistory({
          characterId: params.id,
          featureId,
          sessionId,
          limit: parsedLimit ?? 50,
          userId: user!.userId,
        });

        return { history };
      } catch (error) {
        logger.error({ msg: 'CLASS_FEATURES_HISTORY error', error });
        return mapClassFeaturesError(
          set,
          error,
          'Failed to get feature history',
          'Character not found',
        );
      }
    },
    { params: characterIdParams, query: featureHistoryQuery },
  )

  /**
   * GET /v1/class-features/:featureId
   * Get a specific feature by ID
   */
  .get(
    '/:featureId',
    async ({ params, set }) => {
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
    },
    { params: featureIdParams },
  );
