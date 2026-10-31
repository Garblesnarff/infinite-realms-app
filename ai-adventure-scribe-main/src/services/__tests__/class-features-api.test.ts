import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn() }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer <redacted>' })),
  loadCachedSession: vi.fn(),
}));

import {
  divineSmiteUseBody,
  flexibleCastingConvertUseBody,
  flexibleCastingCreateUseBody,
  quickenedMetamagicUseBody,
} from '../../../shared/test-fixtures/feature-use-bodies';

import { waitForAuth } from '@/lib/auth-gate';
import { loadCachedSession } from '@/services/auth/TokenService';
import { spendCharacterFeature } from '@/services/class-features-api';

/**
 * #1233: the sender posts the shared fixture's wire body to the use route, exactly. The
 * server test posts the same body through the real route schema, so a body the route
 * refuses can never pass both (#2286 pattern).
 */
describe('spendCharacterFeature wire bodies (#1233)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(waitForAuth).mockResolvedValue(undefined);
    vi.mocked(loadCachedSession).mockReturnValue({ access_token: 'access-token' });
  });

  const expectPosted = async (
    characterId: string,
    featureId: string,
    wireBody: Record<string, unknown>,
  ): Promise<void> => {
    const response = {
      ok: true,
      json: vi.fn().mockResolvedValue({ success: true, usesRemaining: 1, effect: '', message: '' }),
    } as unknown as Response;
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(response);

    await expect(spendCharacterFeature(characterId, featureId, wireBody)).resolves.toMatchObject({
      success: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `http://localhost:8888/v1/class-features/characters/${encodeURIComponent(characterId)}/features/${encodeURIComponent(featureId)}/use`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(wireBody),
      }),
    );
  };

  it('posts the Divine Smite slot level', async () => {
    await expectPosted('character-1', 'feature-1', divineSmiteUseBody);
  });

  it('posts the Metamagic option', async () => {
    await expectPosted('character-1', 'feature-2', quickenedMetamagicUseBody);
  });

  it('posts the Flexible Casting slot level for both directions', async () => {
    await expectPosted('character-1', 'feature-3', flexibleCastingConvertUseBody);
    await expectPosted('character-1', 'feature-4', flexibleCastingCreateUseBody);
  });

  it('throws on a non-OK response', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 } as unknown as Response);
    await expect(
      spendCharacterFeature('character-1', 'feature-1', divineSmiteUseBody),
    ).rejects.toThrow('Class feature use failed with status 400');
  });
});
