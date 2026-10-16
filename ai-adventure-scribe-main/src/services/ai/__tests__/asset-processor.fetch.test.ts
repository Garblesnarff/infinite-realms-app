import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: vi.fn() } }));
vi.mock('@/services/user-data-api', () => ({
  userDataApi: { listStarterCharacterTemplates: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { fetchCampaignAssetsForPrompt } from '../asset-processor';

import { supabase } from '@/integrations/supabase/client';
import { userDataApi } from '@/services/user-data-api';

describe('fetchCampaignAssetsForPrompt chunk_type mapping (#2198)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('tags faction and scene chunks with their own asset types', async () => {
    vi.mocked(userDataApi.listStarterCharacterTemplates).mockResolvedValueOnce([]);
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      not: vi.fn(() => chain),
      then: (resolve: any) =>
        resolve({
          data: [
            {
              entity_name: 'Eternal Feast',
              chunk_type: 'faction',
              metadata: { image_url: 'https://example.test/f.webp' },
            },
            {
              entity_name: 'The Wedding Play',
              chunk_type: 'scene',
              metadata: { image_url: 'https://example.test/s.webp' },
            },
          ],
          error: null,
        }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain);

    const prompt = await fetchCampaignAssetsForPrompt('a-midsummer-nights-chaos');

    expect(prompt).toContain('- Eternal Feast [ASSET:faction:eternal-feast]');
    expect(prompt).toContain('- The Wedding Play [ASSET:scene:the-wedding-play]');
    expect(prompt).not.toContain('[ASSET:npc:eternal-feast]');
  });
});

describe('fetchCampaignAssetsForPrompt player-character marking (#708)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const apprenticeTemplate = {
    name: 'The Apprentice',
    template_key: 'the-apprentice',
    portrait_url: 'https://example.test/apprentice.webp',
  };
  const gourmandTemplate = {
    name: 'The Gourmand',
    template_key: 'the-gourmand',
    portrait_url: 'https://example.test/gourmand.webp',
  };

  function mockAcademyLore() {
    vi.mocked(userDataApi.listStarterCharacterTemplates).mockResolvedValueOnce([
      apprenticeTemplate,
      gourmandTemplate,
    ]);
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      not: vi.fn(() => chain),
      then: (resolve: any) =>
        resolve({
          data: [
            {
              entity_name: 'Head Chef Balthazar',
              chunk_type: 'npc_tier1',
              metadata: { image_url: 'https://example.test/balthazar.webp' },
            },
          ],
          error: null,
        }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain);
  }

  it("marks the player's own premade so the DM does not introduce them as an NPC", async () => {
    mockAcademyLore();

    const prompt = await fetchCampaignAssetsForPrompt(
      'academy-of-arcane-gastronomy',
      'The Apprentice',
    );

    expect(prompt).toContain(
      '- The Apprentice [ASSET:character:the-apprentice] — THIS IS THE PLAYER\'S OWN CHARACTER. Do NOT introduce them as an NPC;',
    );
    // The tag itself survives: it is how the player's portrait renders.
    expect(prompt).toContain('[ASSET:character:the-apprentice]');
    // Other templates stay bare introduce-able lines.
    expect(prompt).toContain('- The Gourmand [ASSET:character:the-gourmand]\n');
    expect(prompt).toContain('- Head Chef Balthazar [ASSET:npc:head-chef-balthazar]\n');
  });

  it('matches the PC name ignoring case and a leading article', async () => {
    mockAcademyLore();

    const prompt = await fetchCampaignAssetsForPrompt(
      'academy-of-arcane-gastronomy',
      'the apprentice',
    );

    expect(prompt).toContain("THIS IS THE PLAYER'S OWN CHARACTER");
    expect(prompt).toContain('- The Gourmand [ASSET:character:the-gourmand]\n');
  });

  it('leaves every line unmarked when no player character name is given', async () => {
    mockAcademyLore();

    const prompt = await fetchCampaignAssetsForPrompt('academy-of-arcane-gastronomy');

    expect(prompt).toContain('- The Apprentice [ASSET:character:the-apprentice]\n');
    expect(prompt).not.toContain("PLAYER'S OWN CHARACTER");
  });

  it('marks a same-named NPC chunk asset too', async () => {
    vi.mocked(userDataApi.listStarterCharacterTemplates).mockResolvedValueOnce([
      apprenticeTemplate,
    ]);
    const chain: any = {
      select: vi.fn(() => chain),
      eq: vi.fn(() => chain),
      not: vi.fn(() => chain),
      then: (resolve: any) =>
        resolve({
          data: [
            {
              entity_name: 'The Apprentice',
              chunk_type: 'npc_tier2',
              metadata: { image_url: 'https://example.test/apprentice-npc.webp' },
            },
          ],
          error: null,
        }),
    };
    vi.mocked(supabase.from).mockReturnValue(chain);

    const prompt = await fetchCampaignAssetsForPrompt(
      'academy-of-arcane-gastronomy',
      'The Apprentice',
    );

    expect(prompt).toContain(
      '- The Apprentice [ASSET:npc:the-apprentice] — THIS IS THE PLAYER\'S OWN CHARACTER.',
    );
  });
});
