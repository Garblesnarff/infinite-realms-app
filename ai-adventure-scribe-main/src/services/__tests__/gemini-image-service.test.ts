import { beforeEach, describe, expect, it } from 'vitest';

import { GeminiImageService } from '../gemini-image-service';

describe('GeminiImageService local usage counter', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('gemini-image-last-usage-date', new Date().toDateString());
  });

  it('reads a valid persisted usage count', () => {
    localStorage.setItem('gemini-image-usage-today', '12');
    const service = new GeminiImageService();

    expect(service.canUseFreeToday()).toBe(true);
    expect(service.getUsageStats()).toMatchObject({ used: 12, limit: 500, remaining: 488 });
  });

  it.each(['12requests', '-1', '9007199254740992'])(
    'fails closed for the invalid persisted count %j',
    (storedUsage) => {
      localStorage.setItem('gemini-image-usage-today', storedUsage);
      const service = new GeminiImageService();

      expect(service.canUseFreeToday()).toBe(false);
      expect(service.getUsageStats()).toMatchObject({ used: 500, limit: 500, remaining: 0 });
    },
  );

  it('clamps an over-limit persisted counter', () => {
    localStorage.setItem('gemini-image-usage-today', '501');
    const service = new GeminiImageService();

    expect(service.canUseFreeToday()).toBe(false);
    expect(service.getUsageStats()).toMatchObject({ used: 500, limit: 500, remaining: 0 });
  });
});
