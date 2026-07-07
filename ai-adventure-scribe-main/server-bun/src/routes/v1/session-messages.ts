import { Elysia, t } from 'elysia';

import { authenticateRequest } from '../../lib/auth.js';
import { CharacterService } from '../../services/character-service.js';
import { SessionMessageService } from '../../services/session/session-message-service.js';
import { SessionService } from '../../services/session-service.js';

import type { DialogueHistory } from '../../../../db/schema/index';

const messageSchema = t.Object({
  id: t.Optional(t.String()),
  speaker_type: t.String({ minLength: 1, maxLength: 32 }),
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
  .derive(async ({ request }) => authenticateRequest(request))
  .onBeforeHandle(({ user, error, set }) => {
    if (error || !user) {
      set.status = 401;
      return { error: error || 'Unauthorized' };
    }
  })
  .get(
    '/:id/messages',
    async ({ params, query, user }) => {
      const [result, session] = await Promise.all([
        SessionMessageService.getRecentMessages(
          params.id,
          user!.userId,
          query.limit,
          query.offset,
        ),
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
    exists: await SessionMessageService.messageExists(
      params.id,
      params.messageId,
      user!.userId,
    ),
  }))
  .post(
    '/:id/messages',
    async ({ params, body, user }) => {
      const payload = Array.isArray(body) ? body : [body];
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
