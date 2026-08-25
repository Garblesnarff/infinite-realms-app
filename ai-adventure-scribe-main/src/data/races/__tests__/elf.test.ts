import { describe, expect, it } from 'vitest';

import { elf } from '../elf';

describe('elf race data', () => {
  it('gives Wood Elf a 35-foot speed', () => {
    expect(elf.subraces?.find(({ id }) => id === 'wood-elf')?.speed).toBe(35);
  });
});
