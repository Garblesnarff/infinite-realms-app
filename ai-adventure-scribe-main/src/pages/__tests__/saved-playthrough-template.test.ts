import { describe, expect, it } from 'vitest';

import { buildSavedPlaythroughs } from '../saved-playthroughs';

const STARTER = 'starter-1';
const SEEKER = '7c2e1f4a-9b3d-4c8e-8a1f-2d3e4f5a6b7c';
const VETERAN = '11111111-2222-4333-8444-555555555555';

const session = (characterId: string, character: Record<string, unknown>, number = 1) => ({
  id: `s-${characterId}-${number}`,
  character_id: characterId,
  campaign_id: 'camp-1',
  starter_campaign_id: STARTER,
  session_number: number,
  status: 'active',
  updated_at: '2026-11-25T10:00:00Z',
  character,
});

const base = { starterCampaignId: STARTER, campaignId: 'camp-1' };

describe('saved playthroughs match by premade (#1741)', () => {
  it('offers a renamed hero to resume: same premade, different name', () => {
    const rows = buildSavedPlaythroughs({
      ...base,
      sessions: [session('h1', { name: 'Mara', starter_template_id: SEEKER })],
      characters: [],
      starterTemplateId: SEEKER,
      heroName: 'The Seeker',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].characterId).toBe('h1');
    expect(rows[0].name).toBe('Mara');
  });

  it('does not offer a hero of another premade', () => {
    const rows = buildSavedPlaythroughs({
      ...base,
      sessions: [session('h2', { name: 'Brenna', starter_template_id: VETERAN })],
      characters: [],
      starterTemplateId: SEEKER,
      heroName: 'The Seeker',
    });
    expect(rows).toHaveLength(0);
  });

  it('still matches a hero made before #1741 by its title', () => {
    const rows = buildSavedPlaythroughs({
      ...base,
      sessions: [session('h3', { name: 'The Seeker', starter_template_id: null })],
      characters: [],
      starterTemplateId: SEEKER,
      heroName: 'The Seeker',
    });
    expect(rows.map((row) => row.characterId)).toEqual(['h3']);
  });

  it('keeps two copies of the same premade apart as two playthroughs', () => {
    const rows = buildSavedPlaythroughs({
      ...base,
      sessions: [
        session('h4', { name: 'Mara', starter_template_id: SEEKER }),
        session('h5', { name: 'Ilse', starter_template_id: SEEKER }),
      ],
      characters: [],
      starterTemplateId: SEEKER,
      heroName: 'The Seeker',
    });
    expect(rows.map((row) => row.name).sort()).toEqual(['Ilse', 'Mara']);
  });
});
