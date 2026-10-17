/**
 * #509: src/utils/context/index.ts re-exported modules that never existed
 * (campaignContext, characterContext, memoryContext) and its buildGameContext
 * had no importers. The barrel is removed; nothing may import it again.
 */
import { describe, expect, it } from 'vitest';

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('utils/context barrel (#509)', () => {
  it('no source file imports the removed barrel or buildGameContext', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.endsWith('no-dead-barrel-509.test.ts'))
      .filter(([, text]) =>
        /from\s+['"](@\/utils\/context|[./]*utils\/context)(\/index)?['"]|\bbuildGameContext\b(?!Section)/.test(
          text,
        ),
      )
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
