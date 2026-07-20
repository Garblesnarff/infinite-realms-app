import { describe, expect, it, vi } from 'vitest';

import {
  SESSION_LIST_API_FIELDS,
  mapSessionListApiRow,
  resolveStarterCampaignIdFromSessionList,
} from '../../../../../shared/session-list-contract.js';
import { getSessionListRouteResult, type SessionListFilters } from '../session-list-handler.js';

describe('GET /v1/sessions list contract', () => {
  it('forwards the frontend filters and returns the exact snake_case shape it reads', async () => {
    const session = {
      id: 'session-1',
      campaignId: 'campaign-1',
      characterId: 'character-1',
      sessionNumber: 1,
      startTime: new Date('2026-07-19T00:00:00Z'),
      endTime: null,
      status: 'active',
      currentSceneDescription: null,
      summary: null,
      sessionNotes: null,
      turnCount: 0,
      sessionState: {},
      starterCampaignId: 'the-eternal-feast',
      campaignVersion: 1,
      ruleset: {},
      createdAt: new Date('2026-07-19T00:00:00Z'),
      updatedAt: new Date('2026-07-19T00:00:00Z'),
    };
    const response = [mapSessionListApiRow(session, null, [])];
    const listSessions = vi.fn(async (_filters: SessionListFilters, _userId: string) => response);

    const result = await getSessionListRouteResult(
      {
        campaign_id: 'campaign-1',
        starter_only: 'true',
        limit: '1',
      },
      'user-1',
      listSessions,
    );

    expect(listSessions).toHaveBeenCalledWith(
      {
        campaignId: 'campaign-1',
        characterId: undefined,
        status: undefined,
        starterOnly: true,
        limit: 1,
        offset: undefined,
      },
      'user-1',
    );
    expect(Object.keys(result[0])).toEqual(SESSION_LIST_API_FIELDS);
    expect(resolveStarterCampaignIdFromSessionList(result)).toBe('the-eternal-feast');
  });

  it('rejects a returned camelCase starter link instead of treating it as no link', () => {
    expect(() =>
      resolveStarterCampaignIdFromSessionList([{ starterCampaignId: 'the-eternal-feast' }]),
    ).toThrow('starter_campaign_id');
  });

  it('treats an empty filtered list as a genuine missing starter link', () => {
    expect(resolveStarterCampaignIdFromSessionList([])).toBeNull();
  });
});
