import { describe, expect, it, vi } from 'vitest';

import {
  formatCampaignStarterLinkPlan,
  parseCliArgs,
  planCampaignStarterLinkBackfill,
  runBackfill,
} from '../scripts/backfill-campaign-starter-links';

describe('backfill-campaign-starter-links', () => {
  it('defaults to dry-run and gates writes behind --apply', () => {
    expect(parseCliArgs([])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--dry-run'])).toEqual({ dryRun: true });
    expect(parseCliArgs(['--apply'])).toEqual({ dryRun: false });
    expect(() => parseCliArgs(['--force'])).toThrow('Unknown option: --force');
  });

  it('plans an unlinked campaign from a starter-linked session', () => {
    const result = planCampaignStarterLinkBackfill({
      campaigns: [
        { id: 'campaign-1', name: 'Abyssal Descent', starter_campaign_id: null },
        { id: 'campaign-2', name: 'Custom', starter_campaign_id: null },
      ],
      sessions: [
        {
          id: 'session-1',
          campaign_id: 'campaign-1',
          starter_campaign_id: 'abyssal-descent',
        },
        { id: 'session-2', campaign_id: 'campaign-2', starter_campaign_id: null },
      ],
    });

    expect(result.plans).toEqual([
      expect.objectContaining({
        campaignId: 'campaign-1',
        starterCampaignId: 'abyssal-descent',
        sourceSessionIds: ['session-1'],
        changed: true,
      }),
    ]);
    const plan = result.plans[0];
    if (!plan) throw new Error('Expected one campaign starter-link plan');
    expect(formatCampaignStarterLinkPlan(plan)).toContain('NULL -> abyssal-descent');
  });

  it('skips a campaign whose sessions carry conflicting starter links', () => {
    const result = planCampaignStarterLinkBackfill({
      campaigns: [{ id: 'campaign-1', name: 'Ambiguous', starter_campaign_id: null }],
      sessions: [
        { id: 'session-1', campaign_id: 'campaign-1', starter_campaign_id: 'starter-a' },
        { id: 'session-2', campaign_id: 'campaign-1', starter_campaign_id: 'starter-b' },
      ],
    });

    expect(result.plans).toHaveLength(0);
    expect(result.skipped[0]?.reason).toContain('sessions disagree');
  });

  it('is idempotent once the campaign-level link has been written', () => {
    const sessions = [
      { id: 'session-1', campaign_id: 'campaign-1', starter_campaign_id: 'starter-a' },
    ];
    const first = planCampaignStarterLinkBackfill({
      campaigns: [{ id: 'campaign-1', name: 'Linked', starter_campaign_id: null }],
      sessions,
    });
    const second = planCampaignStarterLinkBackfill({
      campaigns: [{ id: 'campaign-1', name: 'Linked', starter_campaign_id: 'starter-a' }],
      sessions,
    });

    const firstPlan = first.plans[0];
    expect(firstPlan).toBeDefined();
    expect(first.plans).toHaveLength(1);
    expect(second.plans).toHaveLength(0);
    expect(second.alreadyLinked).toBe(1);
  });

  it('keeps the backfill read-only during a dry run', async () => {
    const update = vi.fn();
    const client = {
      from: (table: string) => ({
        select: async () => ({
          data:
            table === 'campaigns'
              ? [{ id: 'campaign-1', name: 'Abyssal Descent', starter_campaign_id: null }]
              : [
                  {
                    id: 'session-1',
                    campaign_id: 'campaign-1',
                    starter_campaign_id: 'abyssal-descent',
                  },
                ],
          error: null,
        }),
        update,
      }),
    } as Parameters<typeof runBackfill>[0]['client'];
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    try {
      await expect(runBackfill({ dryRun: true, client })).resolves.toMatchObject({
        scanned: 1,
        needingRepair: 1,
        applied: 0,
        failed: 0,
      });
      expect(update).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Would update'));
    } finally {
      log.mockRestore();
    }
  });
});
