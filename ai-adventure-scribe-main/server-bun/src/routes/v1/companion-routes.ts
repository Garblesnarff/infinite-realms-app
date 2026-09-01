import { Elysia, t } from 'elysia';

import { isCompanionsEnabled } from '../../lib/companion-feature.js';
import { AppError } from '../../lib/errors.js';

import type { verifySessionOwnership } from './combat/helpers.js';
import type { requireAuth } from '../../middleware/auth.js';
import type {
  CompanionRollRequest,
  CompanionService,
  mapCompanion,
} from '../../services/session/companion-service.js';

export interface CompanionRouteOptions {
  auth: typeof requireAuth;
  verifyOwnership: typeof verifySessionOwnership;
  service: typeof CompanionService;
  mapCompanion: typeof mapCompanion;
}

const sessionParams = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
});

const companionParams = t.Object({
  id: t.String({ minLength: 1, maxLength: 255 }),
  companionId: t.String({ minLength: 1, maxLength: 255 }),
});

const sceneQuery = t.Object({
  companion_id: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
});

const rollKind = t.Union([t.Literal('skill'), t.Literal('ability'), t.Literal('save')]);

function mapRouteError(set: { status?: unknown }, error: unknown) {
  if (error instanceof AppError) {
    set.status = error.statusCode;
    return { error: error.message, ...(error.details ? { details: error.details } : {}) };
  }
  set.status = 500;
  return { error: 'Companion request failed' };
}

export function createCompanionRoutes({
  auth,
  verifyOwnership,
  service,
  mapCompanion,
}: CompanionRouteOptions) {
  return new Elysia({ prefix: '/v1/sessions' })
    .use(auth)
    .onBeforeHandle(async ({ params, user, set }) => {
      if (!isCompanionsEnabled()) {
        set.status = 404;
        return { error: 'Not found' };
      }
      const access = await verifyOwnership(params.id, user!.userId);
      if (!access.success) {
        set.status = access.error?.status || 404;
        return { error: access.error?.message || 'Session not found' };
      }
    })
    .post(
      '/:id/companions',
      async ({ params, body, user, set }) => {
        try {
          const companion = await service.join(params.id, body.character_id, user!.userId);
          return {
            companion: mapCompanion(companion),
            party: await service.party(params.id, user!.userId),
          };
        } catch (error) {
          return mapRouteError(set, error);
        }
      },
      {
        params: sessionParams,
        body: t.Object({ character_id: t.String({ minLength: 1, maxLength: 255 }) }),
      },
    )
    .get(
      '/:id/companions',
      async ({ params, user, set }) => {
        try {
          return { companions: await service.activeCompanions(params.id, user!.userId) };
        } catch (error) {
          return mapRouteError(set, error);
        }
      },
      { params: sessionParams },
    )
    .delete(
      '/:id/companions/:companionId',
      async ({ params, set }) => {
        try {
          return { companion: mapCompanion(await service.leave(params.id, params.companionId)) };
        } catch (error) {
          return mapRouteError(set, error);
        }
      },
      { params: companionParams },
    )
    .get(
      '/:id/scene',
      async ({ params, query, user, set }) => {
        try {
          return await service.scene(params.id, user!.userId, query.companion_id);
        } catch (error) {
          return mapRouteError(set, error);
        }
      },
      { params: sessionParams, query: sceneQuery },
    )
    .post(
      '/:id/companions/:companionId/say',
      async ({ params, body, user, set }) => {
        try {
          const message = await service.say(params.id, params.companionId, body.text, user!.userId);
          return {
            message: {
              id: message.id,
              session_id: message.sessionId,
              speaker_type: message.speakerType,
              text: message.message,
            },
          };
        } catch (error) {
          return mapRouteError(set, error);
        }
      },
      {
        params: companionParams,
        body: t.Object({ text: t.String({ minLength: 1, maxLength: 20_000 }) }),
      },
    )
    .post(
      '/:id/companions/:companionId/roll',
      async ({ params, body, user, set }) => {
        try {
          return await service.roll(
            params.id,
            params.companionId,
            body as CompanionRollRequest,
            user!.userId,
          );
        } catch (error) {
          return mapRouteError(set, error);
        }
      },
      {
        params: companionParams,
        body: t.Object({
          kind: rollKind,
          name: t.String({ minLength: 1, maxLength: 64 }),
          reason: t.Optional(t.String({ maxLength: 500 })),
        }),
      },
    );
}
