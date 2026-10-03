/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2517: a session whose character has fallen is terminal. The single truth
 * is `character_stats.vital_state` (written by CharacterVitalsService's
 * combat mirror during the killing resolution). Player messages must be
 * refused here — #2465 only refused the next DM generate, so run D2's dead
 * character could still post "Hello?" and have it stored. Fixtures follow
 * the real producer, CharacterVitalsService.getVitals
 * (character-vitals-service.ts), which returns the CharacterVitals shape;
 * the wire body is the one the client really sends (use-messages.ts
 * saveSessionMessages / userDataApi.saveSessionMessages).
 */
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

let vitalState: string = 'standing';
let vitalsError: Error | null = null;
let addMessagesCalls: Array<Array<Record<string, unknown>>> = [];

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const authHeader = request.headers.get('authorization');
    if (authHeader === 'Bearer test-token-1') {
      return { user: { userId: 'user-1', email: 'user@example.test', plan: 'free' }, error: null };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://user:pass@localhost:5432/testdb',
    PORT: '8892',
    CORS_ORIGIN: 'http://localhost:8891',
    WORKOS_API_KEY: 'test-workos-key',
    WORKOS_CLIENT_ID: 'test-workos-client',
    NODE_ENV: 'test',
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

const helpersPath = import.meta.resolve('../combat/helpers.js');
mock.module(helpersPath, () => ({
  verifySessionOwnership: async (sessionId: string, userId: string) => {
    if (sessionId === 'valid-session-id' && userId === 'user-1') {
      return {
        success: true,
        session: { id: 'valid-session-id', campaignId: 'camp-1', characterId: 'char-1' },
      };
    }
    return { success: false, error: { status: 404, message: 'Session not found' } };
  },
  verifyEncounterOwnership: async () => ({ success: true }),
}));

mock.module('../../../services/session/session-message-service.js', () => ({
  SessionMessageService: {
    getRecentMessages: async () => ({
      messages: [],
      hasMore: false,
      total: 0,
    }),
    addMessages: async (messages: Array<Record<string, unknown>>) => {
      addMessagesCalls.push(messages);
      return messages.map((message, index) => ({
        id: `stored-${index}`,
        sessionId: message.sessionId,
        speakerType: message.speakerType,
        speakerId: message.speakerId ?? null,
        message: message.message,
        context: message.context ?? null,
        images: message.images ?? null,
        sequenceNumber: index + 1,
        timestamp: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
    },
    messageExists: async () => true,
  },
}));

mock.module('../../../services/session-service.js', () => ({
  SessionService: {
    getSessionById: async () => ({
      id: 'valid-session-id',
      campaignId: 'camp-1',
      characterId: 'char-1',
    }),
  },
}));

mock.module('../../../services/character-service.js', () => ({
  CharacterService: {
    getById: async () => ({
      id: 'char-1',
      name: 'The Scholar',
      avatarUrl: 'https://example.com/avatar.png',
    }),
  },
}));

// The full CharacterVitals shape CharacterVitalsService.getVitals returns.
mock.module('../../../services/character-vitals-service.js', () => ({
  CharacterVitalsService: {
    getVitals: async () => {
      if (vitalsError) throw vitalsError;
      return {
        characterId: 'char-1',
        currentHitPoints: vitalState === 'dead' ? 0 : 7,
        maxHitPoints: 7,
        temporaryHitPoints: 0,
        isConscious: vitalState === 'standing',
        deathSavesSuccesses: 0,
        deathSavesFailures: vitalState === 'dead' ? 3 : 0,
        vitalState,
        diedAt: vitalState === 'dead' ? new Date('2026-10-02T14:51:00.000Z') : null,
      };
    },
  },
}));

const { sessionMessageRoutes } = await import('../session-messages.js');

const app = new Elysia().use(sessionMessageRoutes);

const postMessage = (body: Record<string, unknown>): Promise<Response> =>
  app.handle(
    new Request('http://localhost/v1/sessions/valid-session-id/messages', {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token-1',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    }),
  );

// The exact body the client sends for a typed player message
// (use-messages.ts saveSessionMessages): { id, message, speaker_type,
// context, timestamp }.
const playerMessage = {
  id: 'msg-hello-1',
  message: 'Hello?',
  speaker_type: 'player',
  context: {},
  timestamp: '2026-10-02T14:51:00.000Z',
};

describe('#2517 fallen sessions refuse player messages', () => {
  beforeEach(() => {
    vitalState = 'standing';
    vitalsError = null;
    addMessagesCalls = [];
  });

  it('refuses a player message when the character has fallen', async () => {
    vitalState = 'dead';

    const response = await postMessage(playerMessage);
    const body: any = await response.json();

    expect(response.status).toBe(409);
    expect(body.terminalState).toBe('party_defeated');
    expect(body.error).toContain('has fallen');
    // Nothing was stored.
    expect(addMessagesCalls).toHaveLength(0);
  });

  it('stores a player message while the character is merely dying', async () => {
    vitalState = 'dying';

    const response = await postMessage(playerMessage);

    expect(response.status).toBe(200);
    expect(addMessagesCalls).toHaveLength(1);
  });

  it('stores a player message when the vitals lookup fails (best-effort gate)', async () => {
    vitalsError = new Error('db unavailable');

    const response = await postMessage(playerMessage);

    expect(response.status).toBe(200);
    expect(addMessagesCalls).toHaveLength(1);
  });

  it('still stores DM messages for a fallen session (reply persistence is unaffected)', async () => {
    vitalState = 'dead';

    const response = await postMessage({
      id: 'msg-dm-1',
      message: 'The tale ends.',
      speaker_type: 'dm',
      context: {},
      timestamp: '2026-10-02T14:51:00.000Z',
    });

    expect(response.status).toBe(200);
    expect(addMessagesCalls).toHaveLength(1);
  });
});
