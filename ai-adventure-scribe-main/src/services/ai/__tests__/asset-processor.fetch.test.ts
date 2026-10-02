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
