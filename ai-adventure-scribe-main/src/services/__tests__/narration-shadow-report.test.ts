import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth-gate', () => ({ waitForAuth: vi.fn() }));
vi.mock('@/services/auth/TokenService', () => ({
  getAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer access-token' })),
  loadCachedSession: vi.fn(),
}));

import {
  CONFRONTATION_WITHOUT_COMBAT_ENTRY_SHADOW_REPORT_BODY,
  FAILED_CHECK_SHADOW_REPORT_BODY,
  NARRATED_DEAD_NPC_SHADOW_REPORT_BODY,
  NARRATED_DEATH_SHADOW_REPORT_BODY,
} from '../../../shared/test-fixtures/narration-shadow-telemetry';

import { waitForAuth } from '@/lib/auth-gate';
import { loadCachedSession } from '@/services/auth/TokenService';
import { reportNarrationShadowHit } from '@/services/client-failure-reporting';

// #468 shadow count: the client sends exactly the shared fixture body (AGENTS.md §4).
describe('reportNarrationShadowHit (#468)', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', fetchMock);
    vi.mocked(waitForAuth).mockResolvedValue(undefined);
    vi.mocked(loadCachedSession).mockReturnValue({ access_token: 'access-token' } as never);
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
  });

  it('posts the fixture body to the client-failure route with pattern names only', async () => {
    reportNarrationShadowHit('narrated_death_without_engine', 'sess-468-fixture', ['you_die']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/v1/telemetry/client-failure');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject(NARRATED_DEATH_SHADOW_REPORT_BODY);
  });

  it('posts the #610 failed-check fixture body with pattern names only', async () => {
    reportNarrationShadowHit('failed_check_harm_without_engine', 'sess-610-fixture', ['rope_burn']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject(FAILED_CHECK_SHADOW_REPORT_BODY);
  });

  // #1595 shadow count: the dead-NPC report posts the shared fixture body, pattern names only.
  it('posts the #1595 dead-NPC fixture body with pattern names only', async () => {
    reportNarrationShadowHit('narrated_dead_npc_acting', 'sess-1595-fixture', [
      'attack',
      'return_or_entry',
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject(NARRATED_DEAD_NPC_SHADOW_REPORT_BODY);
  });

  // #1704 shadow count: the confrontation-without-combat-entry report posts the shared fixture body.
  it('posts the #1704 confrontation fixture body with pattern names only', async () => {
    reportNarrationShadowHit('confrontation_without_combat_entry', 'sess-1704-fixture', [
      'rushes',
      'squares_up',
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject(CONFRONTATION_WITHOUT_COMBAT_ENTRY_SHADOW_REPORT_BODY);
  });
});
