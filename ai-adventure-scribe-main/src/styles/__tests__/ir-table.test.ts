import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(process.cwd(), 'src/styles/ir-table.css'), 'utf8');

describe('Table materials', () => {
  it('defines the materials consumed by Table components', () => {
    for (const name of [
      'table-walnut',
      'table-felt',
      'parchment',
      'parchment-edge',
      'brass-btn',
      'wax-seal',
      'wax-seal--red',
      'wax-seal--gold',
      'wax-seal--slate',
      'index-card',
      'candle',
      'tent-card',
      'tent-card--player',
      'tent-card--foe',
      'tent-card--current',
      'action-card',
      'idea-card',
      'ink-reveal',
    ]) {
      expect(css).toContain(`.ir-${name}`);
    }
  });

  it('ships small texture tiles and honors both reduced-motion controls', () => {
    for (const name of ['walnut', 'felt', 'parchment']) {
      expect(statSync(resolve(process.cwd(), `public/table/${name}.webp`)).size).toBeLessThan(
        40_000,
      );
    }
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).toContain("data-reduce-motion='on'");
  });
});
