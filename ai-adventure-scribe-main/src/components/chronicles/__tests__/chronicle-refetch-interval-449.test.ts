import { describe, expect, it } from 'vitest';

import { chronicleRefetchInterval } from '../ChronicleViewer';

describe('chronicleRefetchInterval (#449)', () => {
  it('polls every 3s while the chronicle is generating', () => {
    expect(chronicleRefetchInterval({ state: { data: { status: 'generating' } } })).toBe(3000);
  });
  it('stops polling when done or when there is no data yet', () => {
    expect(chronicleRefetchInterval({ state: { data: { status: 'complete' } } })).toBe(false);
    expect(chronicleRefetchInterval({ state: { data: undefined } })).toBe(false);
  });
});
