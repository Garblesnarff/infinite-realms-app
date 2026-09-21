import { describe, expect, it } from 'bun:test';

import { isAppleDoubleSidecar } from '../../scripts/apple-double.ts';

describe('isolated bun test glob', () => {
  it('treats macOS AppleDouble sidecars as not runnable', () => {
    expect(isAppleDoubleSidecar('src/routes/v1/__tests__/._telemetry.test.ts')).toBe(true);
    expect(isAppleDoubleSidecar('src/._foo.test.ts')).toBe(true);
    expect(isAppleDoubleSidecar('src/routes/v1/__tests__/telemetry.test.ts')).toBe(false);
  });
});
