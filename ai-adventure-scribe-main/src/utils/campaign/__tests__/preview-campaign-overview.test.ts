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

  it('skips a title-only opening to the first section with prose (#2281)', () => {
    const overview = [
      '# The Eternal Feast',
      '',
      '---',
      '',
      '## Campaign Overview',
      '',
      'A banquet that has lasted a hundred years, and **you** are the new server.',
      '',
      '## Act One',
      '',
      'Spoilers.',
    ].join('\n');

    expect(previewCampaignOverview(overview)).toBe(
      'A banquet that has lasted a hundred years, and you are the new server.',
    );
  });

  it('returns nothing when no section has prose', () => {
    expect(previewCampaignOverview('# The Eternal Feast\n\n---\n\n## Campaign Overview\n')).toBe(
      '',
    );
  });
});
