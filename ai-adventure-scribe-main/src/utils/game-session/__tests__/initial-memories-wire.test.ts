import { describe, it, expect, vi } from 'vitest';

import {
  CONTINUATION_CAMPAIGN,
  CONTINUATION_CHARACTER,
  CONTINUATION_GREETING_TEXT,
  initialMemoryWireBodies,
} from '../../../../shared/test-fixtures/continuation-session-init-save';
import { createInitialMemories } from '../initial-greeting-memories';

import type { Campaign } from '@/types/campaign';
import type { Character } from '@/types/character';
import type { Memory } from '@/types/memory';

vi.mock('@/lib/logger', () => ({
  default: { info: vi.fn(), error: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn() },
}));

describe('opening memories wire bodies (#2386)', () => {
  it('createInitialMemories hands out exactly the records the server tests post, each marked is_initial_memory', async () => {
    const created: Array<Omit<Memory, 'id' | 'created_at' | 'updated_at'>> = [];

    await createInitialMemories(
      'session-1',
      CONTINUATION_CHARACTER as unknown as Character,
      CONTINUATION_CAMPAIGN as unknown as Campaign,
      CONTINUATION_GREETING_TEXT,
      async (memory) => {
        created.push(memory);
      },
    );

    expect(created).toEqual(initialMemoryWireBodies('session-1'));
    // The server skips a record that carries this mark when the session already holds one.
    expect(created.every((memory) => memory.metadata?.is_initial_memory === true)).toBe(true);
  });
});
