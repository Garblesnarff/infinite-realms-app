import { describe, expect, it, mock } from 'bun:test';
import { Elysia } from 'elysia';

import { NotFoundError } from '../../../lib/errors.js';

const noopLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

mock.module('../../../lib/env.js', () => ({
  env: {
    DATABASE_URL: 'postgres://test.invalid/unused',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:3000',
    WORKOS_CLIENT_ID: 'test-client-id',
    NODE_ENV: 'test',
  },
}));

mock.module('../../../lib/logger.js', () => ({ logger: noopLogger }));

mock.module('../../../lib/auth.js', () => ({
  authenticateRequest: async (request: Request) => {
    const token = request.headers.get('authorization');
    if (token === 'Bearer owner-token') {
      return { user: { userId: 'user-1', email: 'owner@example.test', plan: 'free' }, error: null };
    }
    if (token === 'Bearer foreign-token') {
      return {
        user: { userId: 'user-2', email: 'foreign@example.test', plan: 'free' },
        error: null,
      };
    }
    return { user: null, error: 'Unauthorized' };
  },
}));

const denyForeign = (userId: string): void => {
  if (userId === 'user-2') throw new NotFoundError('Resource');
};

const service = {
  assertCharacterOwnership: mock(async (_characterId: string, userId: string) =>
    denyForeign(userId),
  ),
  assertSessionOwnership: mock(async (_sessionId: string, userId: string) => denyForeign(userId)),
  getCharacterEquipment: mock(async (_characterId: string, userId: string) => {
    denyForeign(userId);
    return [{ id: 'equipment-1', character_id: 'character-1', item_name: 'Longsword' }];
  }),
  upsertCharacterEquipment: mock(async (_characterId: string, userId: string) => {
    denyForeign(userId);
    return [];
  }),
  getSessionMappings: mock(async (_sessionId: string, userId: string) => {
    denyForeign(userId);
    return [
      {
        id: 'mapping-1',
        session_id: 'session-1',
        character_name: 'Mira',
        voice_id: 'voice-1',
        voice_category: 'hero_female',
        appearance_count: 1,
        first_appearance: null,
        last_used: null,
        metadata: {},
        created_at: null,
        updated_at: null,
      },
    ];
  }),
  upsertVoiceMapping: mock(async (_sessionId: string, userId: string) => {
    denyForeign(userId);
    return {
      id: 'mapping-1',
      session_id: 'session-1',
      character_name: 'Mira',
      voice_id: 'voice-1',
    };
  }),
  updateVoiceMapping: mock(async (_mappingId: string, userId: string) => {
    denyForeign(userId);
    return { id: 'mapping-1', session_id: 'session-1', appearance_count: 2 };
  }),
  getVoiceProfile: mock(async (_characterId: string, userId: string) => {
    denyForeign(userId);
    return null;
  }),
  upsertVoiceProfile: mock(async (_characterId: string, userId: string) => {
    denyForeign(userId);
    return {
      id: 'profile-1',
      character_id: 'character-1',
      voice_style: 'steady',
      speech_patterns: [],
      vocabulary_level: 'average',
      tone: 'calm',
      quirks: [],
      example_phrases: [],
      consistency_score: 0,
    };
  }),
  recordCharacterCreationMetric: mock(
    async (userId: string, input: { character_id?: string | null }) => {
      if (input.character_id) denyForeign(userId);
      return { id: 'metric-1' };
    },
  ),
  recordSafetyEvent: mock(async (_sessionId: string, userId: string) => {
    denyForeign(userId);
    return { id: 'audit-1' };
  }),
  getSessionConfig: mock(async (_sessionId: string, userId: string) => {
    denyForeign(userId);
    return null;
  }),
};

mock.module('../../../services/issue-1784-data-service.js', () => ({
  Issue1784DataService: service,
}));

const { issue1784DataRoutes } = await import('../issue-1784-data.js');
const app = new Elysia().use(issue1784DataRoutes);

type Operation = {
  path: string;
  method?: string;
  body?: unknown;
};

const operations: Operation[] = [
  { path: '/v1/characters/character-1/equipment' },
  { path: '/v1/characters/character-1/voice-profile' },
  {
    path: '/v1/characters/character-1/voice-profile',
    method: 'PUT',
    body: { voice_style: 'steady' },
  },
  { path: '/v1/sessions/session-1/voice-mappings' },
  {
    path: '/v1/sessions/session-1/voice-mappings',
    method: 'POST',
    body: { character_name: 'Mira', voice_category: 'hero_female', voice_id: 'voice-1' },
  },
  {
    path: '/v1/voice-mappings/mapping-1',
    method: 'PATCH',
    body: { appearance_count: 2 },
  },
  {
    path: '/v1/sessions/session-1/safety-events',
    method: 'POST',
    body: { event_type: 'pause' },
  },
  { path: '/v1/sessions/session-1/config' },
  {
    path: '/v1/telemetry/character-creation-flow',
    method: 'POST',
    body: { flow: 'new', character_id: 'character-1' },
  },
];

const requestFor = (operation: Operation, token?: string): Request =>
  new Request(`http://localhost${operation.path}`, {
    method: operation.method || 'GET',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(operation.body ? { 'content-type': 'application/json' } : {}),
    },
    ...(operation.body ? { body: JSON.stringify(operation.body) } : {}),
  });

describe('issue #1784 authenticated table routes', () => {
  it('requires authentication for every replacement route', async () => {
    const statuses = await Promise.all(
      operations.map(async (operation) => (await app.handle(requestFor(operation))).status),
    );

    expect(statuses).toEqual(Array(operations.length).fill(401));
  });

  it('returns 404 for a foreign character or session on every route', async () => {
    const statuses = await Promise.all(
      operations.map(
        async (operation) => (await app.handle(requestFor(operation, 'foreign-token'))).status,
      ),
    );

    expect(statuses).toEqual(Array(operations.length).fill(404));
  });

  it('dispatches every operation with the authenticated owner subject', async () => {
    const responses = await Promise.all(
      operations.map(async (operation) => app.handle(requestFor(operation, 'owner-token'))),
    );

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200, 200, 201, 200, 204,
    ]);
    expect(service.getCharacterEquipment).toHaveBeenCalledWith('character-1', 'user-1');
    expect(service.getVoiceProfile).toHaveBeenCalledWith('character-1', 'user-1');
    expect(service.getSessionMappings).toHaveBeenCalledWith('session-1', 'user-1');
    expect(service.updateVoiceMapping).toHaveBeenCalledWith('mapping-1', 'user-1', 2);
    expect(service.recordSafetyEvent).toHaveBeenCalledWith(
      'session-1',
      'user-1',
      expect.objectContaining({ event_type: 'pause' }),
    );
    expect(service.recordCharacterCreationMetric).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ flow: 'new', character_id: 'character-1' }),
    );
  });
});
