import { describe, expect, it } from 'vitest';

import { filterValidHandoutActions } from '../valid-handout-actions';

describe('filterValidHandoutActions', () => {
  it('keeps schema-valid authored and improvised actions and drops malformed output', () => {
    const authored = {
      mode: 'authored',
      key: 'alpha-journal',
      title: 'Alpha Journal',
      body: null,
      giver: 'Professor Darkwater',
    };
    const improvised = {
      mode: 'improvised',
      key: null,
      title: 'Field Notes',
      body: 'A page of observations.',
      giver: 'Professor Darkwater',
    };
    const result = filterValidHandoutActions([
      authored,
      improvised,
      { mode: 'authored', key: 'alpha-journal', title: 'Alpha Journal', giver: 'Darkwater' },
    ]);

    expect(result).toEqual({ actions: [authored, improvised], dropped: 1 });
  });

  it('trims a valid batch to the route cap of 10 and counts the rest as dropped', () => {
    const makeAction = (n: number): { mode: string; key: null; title: string; body: string; giver: string } => ({
      mode: 'improvised',
      key: null,
      title: `Field Notes ${n}`,
      body: 'A page of observations.',
      giver: 'Professor Darkwater',
    });
    const actions = Array.from({ length: 12 }, (_, i) => makeAction(i + 1));

    const result = filterValidHandoutActions(actions);

    expect(result.actions).toHaveLength(10);
    expect(result.actions.map((action) => action.title)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Field Notes ${i + 1}`),
    );
    expect(result.dropped).toBe(2);
  });

  it('counts invalid and over-cap actions together as dropped', () => {
    const makeAction = (n: number): { mode: string; key: null; title: string; body: string; giver: string } => ({
      mode: 'improvised',
      key: null,
      title: `Field Notes ${n}`,
      body: 'A page of observations.',
      giver: 'Professor Darkwater',
    });
    const invalid = {
      mode: 'authored',
      key: 'alpha-journal',
      title: 'Alpha Journal',
      giver: 'Darkwater',
    };
    const actions = [invalid, ...Array.from({ length: 11 }, (_, i) => makeAction(i + 1))];

    const result = filterValidHandoutActions(actions);

    expect(result.actions).toHaveLength(10);
    expect(result.dropped).toBe(2);
  });
});
