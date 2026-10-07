import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn() }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer access-token' })),
  loadCachedSession: vi.fn(),
}));

import { waitForAuth } from '@/lib/auth-gate';
import { APP_BUILD_VERSION } from '@/services/app-version';
import { loadCachedSession } from '@/services/auth/TokenService';
import { userDataApi } from '@/services/user-data-api';

describe('userDataApi tactical transport', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(waitForAuth).mockResolvedValue(undefined);
    vi.mocked(loadCachedSession).mockReturnValue({ access_token: 'access-token' });
  });

  it('preserves tactical endpoint paths, payloads, and non-OK responses', async () => {
    const response = {
      ok: false,
      json: vi.fn().mockResolvedValue({ error: 'Refused' }),
    } as unknown as Response;
    fetchMock.mockResolvedValue(response);

    await expect(userDataApi.getTacticalMapContext('session id', 'entity/id')).resolves.toBe(
      response,
    );
    await expect(
      userDataApi.enterCombat('session id', {
        combatants: [{ name: 'Goblin', count: 1 }],
        sceneSpec: { width: 10, height: 10 },
        player: { characterId: 'character-1', name: 'Rook', initiativeModifier: 0 },
      }),
    ).resolves.toBe(response);
    await expect(userDataApi.endTacticalMap('session id')).resolves.toBe(response);
    await expect(
      userDataApi.applyTacticalMapAction('session id', {
        action: 'move',
        entityId: 'entity/id',
        x: 2,
        y: 4,
      }),
    ).resolves.toBe(response);

    expect(waitForAuth).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'http://localhost:8888/v1/sessions/session%20id/tactical-map/context/entity%2Fid',
      { headers: { Authorization: 'Bearer access-token' } },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'http://localhost:8888/v1/combat/sessions/session%20id/enter',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access-token' },
        body: JSON.stringify({
          combatants: [{ name: 'Goblin', count: 1 }],
          sceneSpec: { width: 10, height: 10 },
          player: { characterId: 'character-1', name: 'Rook', initiativeModifier: 0 },
        }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      'http://localhost:8888/v1/sessions/session%20id/tactical-map/end',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access-token' },
        body: JSON.stringify({ combat_exits: [] }),
      },
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      'http://localhost:8888/v1/sessions/session%20id/tactical-map/action',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer access-token' },
        body: JSON.stringify({ action: 'move', entityId: 'entity/id', x: 2, y: 4 }),
      },
    );
  });
});

describe('userDataApi request errors (#2280)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(waitForAuth).mockResolvedValue(undefined);
    vi.mocked(loadCachedSession).mockReturnValue({ access_token: 'access-token' });
  });

  it("reports the status and the validation issue, not a bare 'Internal Server Error'", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: 'Validation failed',
          issues: [{ path: '/message', message: 'Expected string length greater or equal to 1' }],
        }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    );

    const failure = await userDataApi
      .saveSessionMessages('session-1', { id: 'dm-1', message: '', speaker_type: 'dm' })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: 'UserDataApiRequestError',
      status: 422,
      message: 'Validation failed (422): /message Expected string length greater or equal to 1',
    });
  });

  it('keeps the status when the body has no JSON', async () => {
    fetchMock.mockResolvedValue(new Response('bad gateway', { status: 502 }));

    const failure = await userDataApi
      .saveSessionMessages('session-1', { id: 'p-1', message: 'hi', speaker_type: 'player' })
      .catch((error: unknown) => error);

    expect(failure).toMatchObject({ status: 502, message: 'Request failed (502)' });
  });
});

describe('userDataApi.reportClientFailure (#2515)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(waitForAuth).mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it('posts the failure with bundle, route and client timestamp for the server log', async () => {
    userDataApi.reportClientFailure(
      'react_error_boundary',
      'sess-9',
      'Error: render blew up\n    at GameContent (chunk.js:1:1)',
      {
        component: 'GameContent',
        componentStack: '\n    at GameContent (chunk.js:1:1)',
        message: 'render blew up',
      },
    );
    // reportClientFailure is fire-and-forget; let the request flush.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/telemetry/client-failure');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.kind).toBe('react_error_boundary');
    expect(body.sessionId).toBe('sess-9');
    expect(body.error).toContain('Error: render blew up');
    expect(body.message).toBe('render blew up');
    expect(body.component).toBe('GameContent');
    expect(body.componentStack).toBe('\n    at GameContent (chunk.js:1:1)');
    expect(body.route).toBe(window.location.pathname);
    expect(body.bundle).toBe(APP_BUILD_VERSION);
    expect(typeof body.clientTimestamp).toBe('string');
    expect(Number.isNaN(Date.parse(body.clientTimestamp as string))).toBe(false);
  });

  it('truncates a very long failure message instead of dropping the report (#2515)', async () => {
    userDataApi.reportClientFailure('unhandled_promise_rejection', 'sess-9', 'e'.repeat(5_000));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect((body.error as string).length).toBe(2_000);
    expect((body.message as string).length).toBe(500);
  });
});
