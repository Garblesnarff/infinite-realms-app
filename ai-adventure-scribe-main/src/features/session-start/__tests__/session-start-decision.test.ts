import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  decidePairSessionStart,
  loadPairSessionStart,
  sessionStartGameTarget,
} from '../session-start-decision';

const mockListSessions = vi.fn();

vi.mock('@/services/user-data-api', () => ({
  userDataApi: {
    listSessions: (...args: unknown[]) => mockListSessions(...args),
  },
}));

const row = (over: Record<string, unknown>): Record<string, unknown> => ({
  id: 'session-1',
  session_number: 1,
  status: 'completed',
  ...over,
});

describe('decidePairSessionStart', () => {
  it('resumes the active session exactly, highest session number first', () => {
    expect(
      decidePairSessionStart([
        row({ id: 'session-old', session_number: 1, status: 'active' }),
        row({ id: 'session-live', session_number: 3, status: 'active' }),
        row({ id: 'session-2', session_number: 2, status: 'completed' }),
      ]),
    ).toEqual({ kind: 'resume', sessionId: 'session-live' });
  });

  it('continues a completed playthrough with the latest row’s starter link', () => {
    expect(
      decidePairSessionStart([
        row({ id: 'session-1', session_number: 1, starter_campaign_id: 'starter-old' }),
        row({ id: 'session-2', session_number: 2, starter_campaign_id: 'starter-last-bout' }),
      ]),
    ).toEqual({ kind: 'continue', starterCampaignId: 'starter-last-bout' });
  });

  it('falls back to the caller’s starter id when the completed row carries none', () => {
    expect(decidePairSessionStart([row({})], 'starter-hub')).toEqual({
      kind: 'continue',
      starterCampaignId: 'starter-hub',
    });
  });

  it('creates when there are no active or completed rows', () => {
    expect(decidePairSessionStart([])).toEqual({ kind: 'create' });
    expect(decidePairSessionStart([{ starter_campaign_id: 'starter-1' }])).toEqual({
      kind: 'create',
    });
  });

  it('ignores non-object rows and an active row without a string id', () => {
    expect(
      decidePairSessionStart([
        null,
        'junk',
        row({ id: 7, session_number: 5, status: 'active' }),
        row({ id: 'session-2', session_number: 2, status: 'completed' }),
      ]),
    ).toEqual({ kind: 'continue', starterCampaignId: null });
  });
});

describe('loadPairSessionStart', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListSessions.mockResolvedValue([]);
  });

  it('pages with limit 100 and decides on the full list', async () => {
    mockListSessions.mockImplementation(({ offset }: { offset?: number }) => {
      if (offset === 0) {
        return Promise.resolve(
          Array.from({ length: 100 }, (_, i) => row({ id: `p1-${i}`, session_number: i + 1 })),
        );
      }
      return Promise.resolve([
        row({ id: 'p2', session_number: 101, starter_campaign_id: 'starter-page-2' }),
      ]);
    });

    const decision = await loadPairSessionStart({ campaignId: 'camp-1', characterId: 'char-1' });

    expect(decision).toEqual({ kind: 'continue', starterCampaignId: 'starter-page-2' });
    expect(mockListSessions).toHaveBeenCalledWith({
      campaignId: 'camp-1',
      characterId: 'char-1',
      limit: 100,
      offset: 0,
    });
    expect(mockListSessions).toHaveBeenCalledWith({
      campaignId: 'camp-1',
      characterId: 'char-1',
      limit: 100,
      offset: 100,
    });
  });

  it('propagates a list failure so the caller can fail closed', async () => {
    mockListSessions.mockRejectedValue(new Error('list down'));
    await expect(
      loadPairSessionStart({ campaignId: 'camp-1', characterId: 'char-1' }),
    ).rejects.toThrow('list down');
  });
});

describe('sessionStartGameTarget', () => {
  it('builds the resume, continue, and create targets', () => {
    expect(
      sessionStartGameTarget({
        campaignId: 'camp-1',
        characterId: 'char-1',
        decision: { kind: 'resume', sessionId: 'session-live' },
      }),
    ).toBe('/app/game/camp-1?character=char-1&session=session-live');
    expect(
      sessionStartGameTarget({
        campaignId: 'camp-1',
        characterId: 'char-1',
        decision: { kind: 'continue', starterCampaignId: 'starter-last-bout' },
      }),
    ).toBe('/app/game/camp-1?character=char-1&starterCampaign=starter-last-bout');
    expect(
      sessionStartGameTarget({
        campaignId: 'camp-1',
        characterId: 'char-1',
        decision: { kind: 'continue', starterCampaignId: null },
      }),
    ).toBe('/app/game/camp-1?character=char-1');
    expect(
      sessionStartGameTarget({
        campaignId: 'camp-1',
        characterId: 'char-1',
        decision: { kind: 'create' },
      }),
    ).toBeNull();
  });
});
