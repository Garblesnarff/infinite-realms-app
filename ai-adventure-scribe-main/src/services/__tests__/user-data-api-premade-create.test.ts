import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PREMADE_TEMPLATE_ID,
  PREMADE_TEMPLATE_ROW,
  premadeCreateBody,
} from '../../../shared/test-fixtures/premade-create-body';

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn() }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer access-token' })),
  loadCachedSession: vi.fn(),
}));

import { waitForAuth } from '@/lib/auth-gate';
import { loadCachedSession } from '@/services/auth/TokenService';
import { buildStarterCharacterSeed } from '@/services/character/starter-character-seeding';
import { userDataApi } from '@/services/user-data-api';

/**
 * #1344 (AGENTS §4): the premade create body must reach the wire intact, so the server can
 * find the starter template. This posts a seeded premade through the real userDataApi and
 * compares the request body with the fixture the real-DB suite posts.
 */
describe('premade create request body (#1344)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(waitForAuth).mockResolvedValue(undefined);
    vi.mocked(loadCachedSession).mockReturnValue({ access_token: 'access-token' } as never);
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id: 'character-1' }), {
        status: 201,
        headers: { 'content-type': 'application/json' },
      }),
    );
  });

  it('sends the premade fixture body, starter_template_id included', async () => {
    const template = {
      id: PREMADE_TEMPLATE_ID,
      name: PREMADE_TEMPLATE_ROW.name,
      race: PREMADE_TEMPLATE_ROW.race,
      class: PREMADE_TEMPLATE_ROW.class,
      level: PREMADE_TEMPLATE_ROW.level,
      background: PREMADE_TEMPLATE_ROW.background,
      abilityScores: PREMADE_TEMPLATE_ROW.abilityScores,
      skills: PREMADE_TEMPLATE_ROW.skills,
      languages: PREMADE_TEMPLATE_ROW.languages,
      equipment: [],
    };
    // The premade create has no campaign on the fixture (campaign_id is null).
    const seed = buildStarterCharacterSeed(template, null as unknown as string);

    await userDataApi.createCharacter(seed);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(premadeCreateBody());
  });
});
