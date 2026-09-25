import { describe, expect, it } from 'vitest';

import { previewCampaignOverview } from '../preview-campaign-overview';

describe('previewCampaignOverview', () => {
  it('strips the heading and italics a new player was seeing raw', () => {
    const overview = [
      '# Abyssal Descent',
      '',
      '*A Horror / Survival campaign — Short Campaign (10–15 sessions) — Very Hard difficulty*',
      '',
      '---',
      '',
      '## Campaign Overview',
      '',
      'The rest of the bible.',
    ].join('\n');

    const preview = previewCampaignOverview(overview);

    expect(preview).not.toMatch(/[#*]/);
    expect(preview).toContain('Abyssal Descent');
    expect(preview).toContain('A Horror / Survival campaign');
    expect(preview).not.toContain('The rest of the bible');
  });
});
