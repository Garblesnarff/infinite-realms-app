import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.vitest.ts'],
    // macOS AppleDouble sidecars (`._*.vitest.ts`) on non-APFS volumes match include globs.
    exclude: ['**/._*'],
    coverage: { enabled: false },
  },
});
