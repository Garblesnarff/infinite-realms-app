import { afterEach, describe, expect, it } from 'bun:test';

import { getBoundedEnvInt } from '../rate-limit.js';

const TEST_KEY = 'TEST_RATE_LIMIT_VALUE';
const bounds = { min: 10, max: 1_000 };

afterEach(() => {
  delete process.env[TEST_KEY];
});

describe('bounded rate-limit environment settings', () => {
  it('uses the fallback when the setting is absent or malformed', () => {
    expect(getBoundedEnvInt(TEST_KEY, 100, bounds)).toBe(100);

    for (const value of ['not-a-number', '20requests', '12.5', 'Infinity']) {
      process.env[TEST_KEY] = value;
      expect(getBoundedEnvInt(TEST_KEY, 100, bounds)).toBe(100);
    }
  });

  it('preserves valid integers inside the configured bounds', () => {
    process.env[TEST_KEY] = '250';

    expect(getBoundedEnvInt(TEST_KEY, 100, bounds)).toBe(250);
  });

  it('clamps integers that exceed either configured bound', () => {
    process.env[TEST_KEY] = '-5';
    expect(getBoundedEnvInt(TEST_KEY, 100, bounds)).toBe(10);

    process.env[TEST_KEY] = '500000';
    expect(getBoundedEnvInt(TEST_KEY, 100, bounds)).toBe(1_000);
  });
});
