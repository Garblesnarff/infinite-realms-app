import { describe, expect, it } from 'vitest';

import { FROZEN_CAMPAIGN_CHAPTER_LABEL, resolveCampaignChapterLabel } from '../campaign-chapter';

describe('resolveCampaignChapterLabel', () => {
  it('freezes the chapter label instead of tracking session turn_count', () => {
    expect(resolveCampaignChapterLabel(0)).toBe(FROZEN_CAMPAIGN_CHAPTER_LABEL);
    expect(resolveCampaignChapterLabel(1)).toBe(FROZEN_CAMPAIGN_CHAPTER_LABEL);
    expect(resolveCampaignChapterLabel(15)).toBe(FROZEN_CAMPAIGN_CHAPTER_LABEL);
    expect(resolveCampaignChapterLabel(null)).toBe(FROZEN_CAMPAIGN_CHAPTER_LABEL);
    expect(resolveCampaignChapterLabel(undefined)).toBe(FROZEN_CAMPAIGN_CHAPTER_LABEL);
    expect(FROZEN_CAMPAIGN_CHAPTER_LABEL).toBe('Chapter 1');
  });

  it('never interpolates the turn count into the label', () => {
    expect(resolveCampaignChapterLabel(15)).not.toMatch(/15/);
    expect(resolveCampaignChapterLabel(0)).not.toBe('Chapter 0');
  });
});
