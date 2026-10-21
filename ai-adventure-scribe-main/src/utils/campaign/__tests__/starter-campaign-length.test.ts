import { describe, expect, it } from 'vitest';

import { formatStarterCampaignLength } from '../starter-campaign-length';

// The overview shape the campaign bible carries and parseOverview stores
// verbatim on the starter campaign row (#829 real-route fixture).
const oneShotOverview = [
  '# Twelve Bells',
  '',
  '**Player Level Range:** Start **3** → Finish **3**',
  '',
  '**Estimated Length:** One-shot — 1 session (2–4 hours)',
  '',
  '## Campaign Overview',
  '',
  'The bell tolls for the village.',
].join('\n');

describe('formatStarterCampaignLength', () => {
  it('labels a one-shot with its hours range', () => {
    expect(formatStarterCampaignLength(oneShotOverview)).toBe('One-shot (2–4 hours)');
  });

  it('normalizes a hyphenated hours range to the en dash label', () => {
    expect(
      formatStarterCampaignLength('**Estimated Length:** One-shot — 1 session (2-4 hours)'),
    ).toBe('One-shot (2–4 hours)');
  });

  it('labels a one-shot whose line gives no hours range', () => {
    expect(formatStarterCampaignLength('**Estimated Length:** One-shot — 1 session')).toBe(
      'One-shot',
    );
  });

  it('returns null for a full campaign length line', () => {
    expect(formatStarterCampaignLength('**Estimated Length:** 8-12 sessions')).toBeNull();
  });

  it('returns null without an overview or a length line', () => {
    expect(formatStarterCampaignLength(null)).toBeNull();
    expect(formatStarterCampaignLength('')).toBeNull();
    expect(formatStarterCampaignLength('# Title\n\nNo length declared.')).toBeNull();
  });
});
