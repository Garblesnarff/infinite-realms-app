import { describe, expect, it, vi } from 'vitest';

import { resolveOrCreateStarterCampaign } from './starter-campaign-bootstrap';

describe('resolveOrCreateStarterCampaign', () => {
  it('persists the starter campaign id on an Explore-created campaign', async () => {
    const createCampaign = vi.fn().mockResolvedValue({ id: 'campaign-1' });
    const api = {
      listCampaigns: vi.fn().mockResolvedValue([]),
      createCampaign,
    };

    await expect(
      resolveOrCreateStarterCampaign(
        {
          id: 'starter-1',
          title: 'Abyssal Descent',
          premise: 'Descend into the abyss.',
          genre: ['fantasy'],
          tone: ['grim'],
          difficulty: 'hard',
          coverImageUrl: null,
        },
        api,
      ),
    ).resolves.toBe('campaign-1');

    expect(createCampaign).toHaveBeenCalledWith(
      expect.objectContaining({ starter_campaign_id: 'starter-1' }),
    );
  });
});
