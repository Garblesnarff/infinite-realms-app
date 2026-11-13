import { Elysia, t } from 'elysia';

import { verifySessionOwnership } from './combat/helpers.js';
import { PLAYER_INPUT_MAX_CHARS } from '../../../../shared/player-input-cap.js';
import { logger } from '../../lib/logger.js';
import { requireAuth } from '../../middleware/auth.js';
import { CharacterService } from '../../services/character-service.js';
import { expireStaleHeldReplies } from '../../services/dm/dm-reply-persistence.js';
import {
  narrativeCheckCard,
  serverVerdictLine,
} from '../../services/session/narrative-check-outcome.js';
import { SessionMessageService } from '../../services/session/session-message-service.js';
import { SessionService } from '../../services/session-service.js';

import type { DialogueHistory } from '../../../../db/schema/index';

/**
 * #1477: the server writes the outcome of a narrative ability check. The client sends the
 * formatter line and the `rollRequestId`. The DC comes from the DM row that issued the request in
 * this session, and the verdict is computed here. Any `engineCards` the client sent on this row
 * is dropped, so a client cannot plant a card. A request this session did not issue gets no card.
 * The stored line's verdict word is then set to the server's verdict, because the DM reads the
 * stored line and must not narrate the client's word.
 */
async function withServerCheckOutcome<
  T extends { speaker_type: string; message: string; context?: Record<string, unknown> },
>(sessionId: string, userId: string, message: T): Promise<T> {
  const context = message.context;
  if (
    message.speaker_type !== 'player' ||
    context?.intent !== 'dice_roll' ||
    typeof context.rollRequestId !== 'string'
  ) {
    return message;
  }
  const rollRequestId = context.rollRequestId;
  const stored: Record<string, unknown> = { ...context };
  delete stored.engineCards;

  const issued = await SessionMessageService.findIssuedRollRequest(
    sessionId,
    userId,
    rollRequestId,
  );
  const card = issued ? narrativeCheckCard({ text: message.message, request: issued }) : null;
  if (!card) {
    logger.warn(
      { sessionId, rollRequestId, issued: issued !== null },
      'narrative check: no server outcome written (unknown request or not a check)',
    );
    return { ...message, context: stored };
  }
  // The DM reads the stored line, so its verdict word is the server's, not the client's.
  const line = serverVerdictLine(message.message, card.badge?.word === 'SUCCESS');
  return { ...message, message: line, context: { ...stored, engineCards: [card] } };
}

// Fields shared by both message schemas below; the speaker type and the
// message cap differ per variant.
const messageCommonFields = {
  id: t.Optional(t.String()),
  speaker_id: t.Optional(t.String()),
  context: t.Optional(t.Record(t.String(), t.Unknown())),
  images: t.Optional(t.Array(t.Unknown(), { maxItems: 20 })),
  timestamp: t.Optional(t.String()),
};

// #1307: the shared player-turn cap applies to PLAYER messages only. DM,
// system, and companion saves flow through this same route (message queue,
// headless client) and DM narration can run long, so they keep the prior
// 100_000 bound — capping them at the player value would 422 long DM saves.
const playerMessageSchema = t.Object({
  ...messageCommonFields,
  speaker_type: t.Literal('player'),
  message: t.String({ minLength: 1, maxLength: PLAYER_INPUT_MAX_CHARS }),
});

const nonPlayerMessageSchema = t.Object({
  ...messageCommonFields,
  speaker_type: t.Union([t.Literal('dm'), t.Literal('system'), t.Literal('companion')]),
  message: t.String({ minLength: 1, maxLength: 100_000 }),
});

const messageSchema = t.Union([playerMessageSchema, nonPlayerMessageSchema]);

// #1270: the server owns the replay-cache keys in DM-row contexts
// (cachedTurnResponse, cachedTurnResponseInput, rollTurnResult, npcResult).
// A client save must never
// plant them: strip them from every saved message context so a planted body
// can never be replayed (engine lines included). The server re-caches on
// completion, so legitimate turns lose nothing.
const SERVER_ONLY_CONTEXT_KEYS = [
  'cachedTurnResponse',
  'cachedTurnResponseInput',
  'rollTurnResult',
  'npcResult',
] as const;

function stripServerOnlyContextKeys(
  context: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!context) return context;
  if (!SERVER_ONLY_CONTEXT_KEYS.some((key) => key in context)) return context;
  const stripped = { ...context };
  for (const key of SERVER_ONLY_CONTEXT_KEYS) delete stripped[key];
  return stripped;
}

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
      // #1444: settle this session's held replies that nothing decided, and retry the publish of its
      // ready replies whose write failed (#1502), before the messages are read,
      // so a reply published here is in this response. Never throws.
      await expireStaleHeldReplies({ sessionId: params.id, userId: user!.userId });
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
  .post(
    '/:id/messages',
    async ({ params, body, user, set }) => {
      const payload = await Promise.all(
        (Array.isArray(body) ? body : [body]).map((message) =>
          withServerCheckOutcome(params.id, user!.userId, message),
        ),
      );
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
          const { CharacterVitalsService } =
            await import('../../services/character-vitals-service.js');
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
          context: stripServerOnlyContextKeys(message.context),
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
