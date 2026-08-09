import { describe, it, expect } from 'vitest';

import { measurePromptSections } from '../prompt-metrics';

describe('measurePromptSections', () => {
  it('returns 0 for empty, null, and undefined sections', () => {
    const metrics = measurePromptSections({
      campaign_and_canon: '',
      scene_state: null,
      history: undefined,
      player_input: '',
    });

    expect(metrics).toEqual({
      campaign_and_canon: 0,
      scene_state: 0,
      history: 0,
      player_input: 0,
      total: 0,
    });
  });

  it('returns just a 0 total for an empty sections object', () => {
    expect(measurePromptSections({})).toEqual({ total: 0 });
  });

  it('produces sane token estimates for known strings (4 chars per token)', () => {
    const metrics = measurePromptSections({
      a: 'a'.repeat(40), // 40 / 4 = 10 tokens
      b: 'b'.repeat(41), // ceil(41 / 4) = 11 tokens
    });

    expect(metrics.a).toBe(10);
    expect(metrics.b).toBe(11);
  });

  it('sums every section into total', () => {
    const metrics = measurePromptSections({
      one: 'x'.repeat(4), // 1 token
      two: 'y'.repeat(8), // 2 tokens
      three: 'z'.repeat(12), // 3 tokens
    });

    expect(metrics.total).toBe(6);
  });

  it('never throws for non-string values passed at runtime', () => {
    const weird = {
      num: 123,
      obj: { nested: true },
      arr: [1, 2, 3],
      fn: () => 'x',
    } as unknown as Record<string, string | null | undefined>;

    expect(() => measurePromptSections(weird)).not.toThrow();

    const metrics = measurePromptSections(weird);
    expect(metrics.num).toBe(0);
    expect(metrics.obj).toBe(0);
    expect(metrics.arr).toBe(0);
    expect(metrics.fn).toBe(0);
    expect(metrics.total).toBe(0);
  });

  it('never throws when the whole input is null or undefined', () => {
    expect(() => measurePromptSections(null as unknown as Record<string, string>)).not.toThrow();
    expect(() =>
      measurePromptSections(undefined as unknown as Record<string, string>),
    ).not.toThrow();
    expect(measurePromptSections(undefined as unknown as Record<string, string>)).toEqual({
      total: 0,
    });
  });
});
