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
});
