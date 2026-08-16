import { describe, expect, it } from 'bun:test';

import { buildBackgroundOrFilter, buildIlikeOrFilter } from '../postgrest-filters.js';

describe('PostgREST filter builders', () => {
  it('quotes and escapes reserved search characters inside each ilike value', () => {
    expect(buildIlikeOrFilter(['title', 'summary'], ' Doe, "Jane" \\ ')).toBe(
      'title.ilike."%doe, \\"jane\\" \\\\%",summary.ilike."%doe, \\"jane\\" \\\\%"',
    );
  });

  it('returns no search filter for whitespace-only input', () => {
    expect(buildIlikeOrFilter(['title'], '   ')).toBeNull();
  });

  it('accepts only the established background identifier grammar', () => {
    expect(buildBackgroundOrFilter('folk-hero_2')).toBe(
      'background.eq.folk-hero_2,background.is.null',
    );
    expect(buildBackgroundOrFilter('folk-hero,source.eq.private')).toBeNull();
    expect(buildBackgroundOrFilter('folk hero')).toBeNull();
  });
});
