import { describe, expect, it } from 'vitest';

import {
  resolveOrCreateStarterCampaign,
  starterCampaignLength,
  type StarterCampaignBootstrapApi,
  type StarterCampaignBootstrapSource,
} from '../starter-campaign-bootstrap';

import type { StarterCampaign } from '@/hooks/use-starter-campaigns';
import type { CampaignPayload } from '@/services/user-data-api';

import { prepareCampaignPayload } from '@/services/user-data-payload-helpers';

/**
 * Fixtures follow the real producer: mapCampaignRow in
 * src/hooks/use-starter-campaigns.ts, which maps a starter_campaigns row to
 * the StarterCampaign the detail page hands to the bootstrap. The one-shot
 * overview and level range are the #829 real-route shape (Start 3 → Finish 3,
 * "One-shot — 1 session (2–4 hours)"); its estimatedSessions '1' is what
 * parseOverview produces for that overview once finding 6 is fixed.
 */
const oneShotOverview = [
  '# The Sown Field',
  '',
  '**Player Level Range:** Start **3** → Finish **3**',
  '**Estimated Length:** One-shot — 1 session (2–4 hours)',
  '**Difficulty:** Medium',
  '',
  'A blight has taken the valley harvest, and the thing planted beneath the field is waking.',
].join('\n');

const oneShotStarter: StarterCampaign = {
  id: 'the-sown-field',
  slug: 'the-sown-field',
  title: 'The Sown Field',
  tagline: 'One night to save the harvest',
  genre: ['fantasy'],
  tone: ['tense'],
  difficulty: 'medium',
  levelRange: '3-3',
  estimatedSessions: '1',
  premise:
    'A blight has taken the valley harvest, and the thing planted beneath the field is waking.',
  creativeBrief: null,
  overview: oneShotOverview,
  isComplete: true,
  isPublished: true,
  isFeatured: false,
  coverImageUrl: null,
  bannerImageUrl: null,
};

const fullOverview = [
  '# The Eternal Feast',
  '',
  '**Player Level Range:** Start **1** → Finish **8**',
  '**Estimated Length:** 8–10 sessions',
  '**Difficulty:** Medium',
  '',
  'A cursed banquet that has run for a hundred years, and every guest owes a course.',
].join('\n');

const fullStarter: StarterCampaign = {
  id: 'the-eternal-feast',
  slug: 'the-eternal-feast',
  title: 'The Eternal Feast',
  tagline: 'A cursed banquet needs a brave guest.',
  genre: ['fantasy'],
  tone: ['gothic'],
  difficulty: 'medium',
  levelRange: '1-8',
  estimatedSessions: '8-10',
  premise: 'A cursed banquet that has run for a hundred years, and every guest owes a course.',
  creativeBrief: null,
  overview: fullOverview,
  isComplete: true,
  isPublished: true,
  isFeatured: true,
  coverImageUrl: '/feast.png',
  bannerImageUrl: null,
};

function makeApi(existing: Array<{ id: string; name: string }> = []): {
  api: StarterCampaignBootstrapApi;
  created: CampaignPayload[];
} {
  const created: CampaignPayload[] = [];
  const api: StarterCampaignBootstrapApi = {
    listCampaigns: async () => existing,
    createCampaign: async (payload) => {
      created.push(payload);
      return { id: 'campaign-new' };
    },
  };
  return { api, created };
}

describe('resolveOrCreateStarterCampaign campaign_length (#829 finding 7)', () => {
  it('bootstraps the one-shot starter as a one-shot campaign', async () => {
    const { api, created } = makeApi();
    const id = await resolveOrCreateStarterCampaign(oneShotStarter, api);

    expect(id).toBe('campaign-new');
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      name: 'The Sown Field',
      description: oneShotStarter.premise,
      genre: 'fantasy',
      tone: 'tense',
      difficulty_level: 'medium',
      campaign_length: 'one-shot',
      status: 'active',
      background_image: null,
    });
    // The value survives the wire preparation (CAMPAIGN_FIELDS allowlist).
    expect(prepareCampaignPayload(created[0]).campaign_length).toBe('one-shot');
  });

  it('still reads a one-shot ingested before the parser fix (estimatedSessions holds the hours range)', async () => {
    const { api, created } = makeApi();
    await resolveOrCreateStarterCampaign({ ...oneShotStarter, estimatedSessions: '2-4' }, api);

    expect(created[0].campaign_length).toBe('one-shot');
  });

  it('reads a numeric-only one-shot length line despite the pre-fix hours range', async () => {
    const { api, created } = makeApi();
    const numericOverview = oneShotOverview.replace(
      '**Estimated Length:** One-shot — 1 session (2–4 hours)',
      '**Estimated Length:** 1 session (2–4 hours)',
    );
    await resolveOrCreateStarterCampaign(
      { ...oneShotStarter, overview: numericOverview, estimatedSessions: '2-4' },
      api,
    );

    expect(created[0].campaign_length).toBe('one-shot');
  });

  it('reads a one-shot from estimatedSessions alone when no overview is carried', async () => {
    const { api, created } = makeApi();
    await resolveOrCreateStarterCampaign({ ...oneShotStarter, overview: null }, api);

    expect(created[0].campaign_length).toBe('one-shot');
  });

  it('PIN: bootstraps a full-length starter as a full campaign', async () => {
    const { api, created } = makeApi();
    await resolveOrCreateStarterCampaign(fullStarter, api);

    expect(created[0].campaign_length).toBe('full');
    expect(prepareCampaignPayload(created[0]).campaign_length).toBe('full');
  });

  it('the overview length line wins over estimatedSessions in both directions', async () => {
    const { api, created } = makeApi();
    await resolveOrCreateStarterCampaign({ ...fullStarter, estimatedSessions: '1' }, api);

    expect(created[0].campaign_length).toBe('full');
  });

  it('PIN: a starter with no length data bootstraps exactly as before (full)', async () => {
    const { api, created } = makeApi();
    await resolveOrCreateStarterCampaign(
      { ...fullStarter, estimatedSessions: null, overview: null },
      api,
    );

    expect(created[0].campaign_length).toBe('full');
  });

  it('reuses an existing campaign by name and creates nothing', async () => {
    const { api, created } = makeApi([{ id: 'campaign-existing', name: 'The Sown Field' }]);
    const id = await resolveOrCreateStarterCampaign(oneShotStarter, api);

    expect(id).toBe('campaign-existing');
    expect(created).toHaveLength(0);
  });
});

describe('starterCampaignLength mapping', () => {
  const base: StarterCampaignBootstrapSource = {
    id: 'x',
    title: 'X',
    premise: 'P',
    genre: ['fantasy'],
    tone: ['epic'],
    difficulty: 'medium',
    coverImageUrl: null,
  };

  it('maps session counts and ranges above one session to full', () => {
    expect(starterCampaignLength({ ...base, estimatedSessions: '2-4' })).toBe('full');
    expect(starterCampaignLength({ ...base, estimatedSessions: '4' })).toBe('full');
    expect(starterCampaignLength({ ...base, estimatedSessions: '1-3' })).toBe('full');
    expect(starterCampaignLength({ ...base, estimatedSessions: null })).toBe('full');
  });

  it('maps a count that tops out at one session to one-shot', () => {
    expect(starterCampaignLength({ ...base, estimatedSessions: '1' })).toBe('one-shot');
    expect(starterCampaignLength({ ...base, estimatedSessions: '1-1' })).toBe('one-shot');
  });

  it('reads a bare One-shot label with no session count', () => {
    const overview = ['# A One-Night Tale', '', '**Estimated Length:** One-shot'].join('\n');
    expect(starterCampaignLength({ ...base, estimatedSessions: null, overview })).toBe('one-shot');
  });

  it('only takes the one-shot declaration from the Estimated Length line, not later prose', () => {
    const overview = [
      '# A Long Campaign',
      '',
      '**Estimated Length:** 6 sessions',
      '',
      'An optional one-shot side quest is included for a session zero.',
    ].join('\n');
    expect(starterCampaignLength({ ...base, estimatedSessions: '6', overview })).toBe('full');
  });
});
