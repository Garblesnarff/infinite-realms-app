import { describe, expect, it, vi } from 'vitest';

import { NotFoundError } from '../../../lib/errors.js';
import { getSessionContextRouteResult } from '../session-context-handler.js';

describe('GET /v1/sessions/:id/context handler', () => {
  it('returns the joined context shape for the authenticated owner', async () => {
    const context = {
      id: 'session-1',
      campaign_id: 'campaign-1',
      character_id: 'character-1',
      campaign: { id: 'campaign-1', name: 'Lost Mine', description: 'Road' },
      character: {
        id: 'character-1',
        name: 'Gundren',
        level: 3,
        race: 'Dwarf',
        class: 'Fighter',
        background: 'Noble',
        character_stats: [{ strength: 16 }],
      },
    };
    const load = vi.fn().mockResolvedValue(context);

    await expect(getSessionContextRouteResult('session-1', 'owner', load)).resolves.toEqual({
      status: 200,
      body: context,
    });
    expect(load).toHaveBeenCalledWith('session-1', 'owner');
  });

  it('returns 404 when the ownership-filtered lookup has no row', async () => {
    const load = vi.fn().mockRejectedValue(new NotFoundError('Session', 'session-1'));
    await expect(getSessionContextRouteResult('session-1', 'non-owner', load)).resolves.toEqual({
      status: 404,
      body: { error: 'Not found' },
    });
  });
});
