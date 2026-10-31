import { describe, expect, it } from 'vitest';

import { definedRollRequests } from '../engine-channel';

describe('definedRollRequests (#781)', () => {
  it('skips a null entry instead of reading type', () => {
    const requests = [null, { type: 'save' }, 'not-a-request'];
    expect(definedRollRequests(requests).map((request) => request.type)).toEqual(['save']);
  });
});
