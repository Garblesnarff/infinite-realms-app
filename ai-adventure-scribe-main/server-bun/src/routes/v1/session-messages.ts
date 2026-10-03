import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { requireAuth } from '../../middleware/auth.js';
import { CharacterService } from '../../services/character-service.js';
import { SessionMessageService } from '../../services/session/session-message-service.js';
import { SessionService } from '../../services/session-service.js';

import type { DialogueHistory } from '../../../../db/schema/index';

const messageSchema = t.Object({
  id: t.Optional(t.String()),
  speaker_type: t.Union([
    t.Literal('player'),
    t.Literal('dm'),
    t.Literal('system'),
    t.Literal('companion'),
  ]),
  speaker_id: t.Optional(t.String()),
  message: t.String({ minLength: 1, maxLength: 100_000 }),
  context: t.Optional(t.Record(t.String(), t.Unknown())),
  images: t.Optional(t.Array(t.Unknown(), { maxItems: 20 })),
  timestamp: t.Optional(t.String()),
});

const mapMessage = (message: DialogueHistory) => ({
  id: message.id,
  session_id: message.sessionId,
  speaker_type: message.speakerType,
  speaker_id: message.speakerId,
  message: message.message,
  context: message.context,
  images: message.images,
  sequence_number: message.sequenceNumber,
  timestamp: message.timestamp,
  created_at: message.createdAt,
  updated_at: message.updatedAt,
});

export const sessionMessageRoutes = new Elysia({ prefix: '/v1/sessions' })
  .use(requireAuth)
  .onBeforeHandle(async ({ params, user, set }) => {
    if (params?.id) {
      const verification = await verifySessionOwnership(params.id, user!.userId);
      if (!verification.success) {
        set.status = verification.error?.status || 404;
        return { error: verification.error?.message || 'Session not found' };
      }
    }
  })
  .get(
    '/:id/messages',
    async ({ params, query, user }) => {
      const [result, session] = await Promise.all([
        SessionMessageService.getRecentMessages(params.id, user!.userId, query.limit, query.offset),
        SessionService.getSessionById(params.id, user!.userId),
      ]);
      const character = session.characterId
        ? await CharacterService.getById(session.characterId, user!.userId)
        : null;
      return {
        ...result,
        messages: result.messages.map((message) => ({
          ...mapMessage(message),
          game_sessions: {
            id: session.id,
            character_id: session.characterId,
            characters: character
              ? { id: character.id, name: character.name, avatar_url: character.avatarUrl }
              : null,
          },
        })),
      };
    },
    {
      query: t.Object({
        limit: t.Optional(t.Number({ minimum: 1, maximum: 200, default: 50 })),
        offset: t.Optional(t.Number({ minimum: 0, default: 0 })),
      }),
    },
  )
  .get('/:id/messages/:messageId', async ({ params, user }) => ({
    exists: await SessionMessageService.messageExists(params.id, params.messageId, user!.userId),
  }))
  .post(
    '/:id/messages',
    async ({ params, body, user, set }) => {
      const payload = Array.isArray(body) ? body : [body];
      // #2517: a dead character's session is terminal. The single truth is
      // `character_stats.vital_state` (written by the vitals mirror during
      // the killing resolution); #2465 refused the next DM generate, but the
      // player's own message was still accepted and stored here first (run
      // D2's "Hello?" at 0 HP). Refuse player messages for a session whose
      // character has fallen; DM/system persistence is unaffected.
      if (payload.some((message) => message.speaker_type === 'player')) {
        try {
          // Dynamic import on purpose (same pattern as llm.ts): a static
          // import pulls the vitals service's db client into every route-test
          // module load, which the isolated harness cannot load.
          const { CharacterVitalsService } = await import(
            '../../services/character-vitals-service.js'
          );
          const session = await SessionService.getSessionById(params.id, user!.userId);
          if (session.characterId) {
            const vitals = await CharacterVitalsService.getVitals(
              session.characterId,
              user!.userId,
            );
            if (vitals.vitalState === 'dead') {
              set.status = 409;
              return {
                error:
                  'This character has fallen and the tale has ended. No further messages can be sent in this session.',
                terminalState: 'party_defeated',
              };
            }
          }
        } catch {
          // Terminal-state lookup is best-effort here, matching /v1/llm/generate:
          // a lookup failure must not block ordinary message persistence.
        }
      }
      const messages = await SessionMessageService.addMessages(
        payload.map((message) => ({
          id: message.id,
          sessionId: params.id,
          speakerType: message.speaker_type,
          speakerId: message.speaker_id,
          message: message.message,
          context: message.context,
          images: message.images,
          timestamp: message.timestamp ? new Date(message.timestamp) : undefined,
        })),
        user!.userId,
      );
      return { messages: messages.map(mapMessage) };
    },
    {
      body: t.Union([messageSchema, t.Array(messageSchema, { minItems: 1, maxItems: 50 })]),
    },
  );
