import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { colors } from '../../../tailwind/colors';

import { buttonVariants } from '@/components/ui/button';

/**
 * Guards the #2258 design tokens: the numbers the ticket quotes (contrast on the
 * navy app surface, gold primary) are asserted here so a later palette tweak
 * cannot silently drop a token below its threshold.
 */
const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

const overhaulCss = read('../ir-overhaul.css');
const indexCss = read('../../index.css');

/** Body of the first top-level `.ir-app { … }` rule (the token block). */
const irAppBlock = (): string => {
  const start = overhaulCss.indexOf('.ir-app {');
  expect(start).toBeGreaterThanOrEqual(0);
  return overhaulCss.slice(start, overhaulCss.indexOf('\n}', start));
};

const token = (name: string): string => {
  const match = irAppBlock().match(new RegExp(`${name}:\\s*([^;]+);`));
  expect(match, `${name} is defined in .ir-app`).not.toBeNull();
  return (match?.[1] ?? '').trim();
};

type Rgb = [number, number, number];

const hex = (value: string): Rgb => {
  const h = value.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
};

const luminance = ([r, g, b]: Rgb): number => {
  const lin = (c: number): number => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const overlay = (fg: Rgb, alpha: number, bg: Rgb): Rgb =>
  fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha))) as Rgb;

const SURFACES: Array<[string, Rgb]> = [
  ['#0c1220 (surface)', hex('#0c1220')],
  ['#070b14 (background)', hex('#070b14')],
];

describe('.ir-app design tokens (#2258)', () => {
  it('retints --primary, --primary-foreground and --ring to gold inside the app', () => {
    expect(token('--primary')).toBe('213 176 112');
    expect(token('--primary-foreground')).toBe('26 18 6');
    expect(token('--ring')).toBe('213 176 112');
  });

  it('no longer patches .bg-primary / .border-primary with !important', () => {
    expect(overhaulCss).not.toMatch(/\.ir-app \.bg-primary\s*\{/);
    expect(overhaulCss).not.toMatch(/\.ir-app \.border-primary\s*\{/);
  });

  it('defines the player/engine tints', () => {
    expect(token('--ir-player')).toBe('rgba(95, 113, 168, 0.2)');
    expect(token('--ir-engine')).toBe('rgba(213, 176, 112, 0.07)');
  });

  describe.each(SURFACES)('text contrast on %s', (_name, surface) => {
    it('--ir-steel-text is at least 8.5:1', () => {
      expect(ratio(hex(token('--ir-steel-text')), surface)).toBeGreaterThanOrEqual(8.5);
    });

    it.each(['--ir-hp-good', '--ir-hp-warn', '--ir-hp-bad', '--infinite-gold'])(
      '%s is at least 4.5:1',
      (name) => {
        expect(ratio(hex(token(name)), surface)).toBeGreaterThanOrEqual(4.5);
      },
    );

    it('--ir-control-border meets the 3:1 non-text minimum', () => {
      expect(token('--ir-control-border')).toBe('rgba(255, 255, 255, 0.4)');
      expect(ratio(overlay([255, 255, 255], 0.4, surface), surface)).toBeGreaterThanOrEqual(3);
    });
  });

  it('gold --primary-foreground is legible on the gold --primary', () => {
    expect(ratio([26, 18, 6], [213, 176, 112])).toBeGreaterThanOrEqual(4.5);
  });

  it('defines one 44px hit box and a 12px text floor (#228)', () => {
    expect(token('--ir-hit-min')).toBe('44px');
    expect(token('--ir-text-min')).toBe('12px');
    expect(overhaulCss).toMatch(
      /\.ir-app \.ir-hit\s*\{[^}]*min-width:\s*var\(--ir-hit-min\);\s*min-height:\s*var\(--ir-hit-min\);/,
    );
    expect(overhaulCss).toMatch(
      /\.ir-app \.ir-hit-slop::before\s*\{[^}]*width:\s*var\(--ir-hit-min\);\s*height:\s*var\(--ir-hit-min\);/,
    );
    expect(overhaulCss).toMatch(
      /\.ir-app \.ir-text-min\s*\{[^}]*font-size:\s*var\(--ir-text-min\);/,
    );
    expect(indexCss).toMatch(
      /\.timeline-rail \.timeline-dot\s*\{[^}]*width:\s*14px;\s*height:\s*14px;/,
    );
  });

  it('draws the keyboard focus ring in gold at 2px', () => {
    expect(overhaulCss).toMatch(
      /\.ir-app :focus-visible\s*\{\s*outline:\s*2px solid var\(--infinite-gold\);\s*outline-offset:\s*2px;\s*\}/,
    );
  });
});

describe('design token wiring (#2258)', () => {
  it('exposes the new tokens as Tailwind color names', () => {
    expect(colors).toMatchObject({
      'ir-steel-text': 'var(--ir-steel-text)',
      'ir-hp-good': 'var(--ir-hp-good)',
      'ir-hp-warn': 'var(--ir-hp-warn)',
      'ir-hp-bad': 'var(--ir-hp-bad)',
    });
  });

  it('points the button focus ring at the --ring token, not cyan', () => {
    const classes = buttonVariants();
    expect(classes).toContain('focus-visible:ring-ring');
    expect(classes).not.toContain('electricCyan');
  });

  it('loads EB Garamond for the narration font', () => {
    expect(indexCss).toContain('family=EB+Garamond:ital,wght@0,400;0,500;1,400');
    expect(overhaulCss).toMatch(/\.ir-narr\s*\{[^}]*'EB Garamond'/);
  });

  it('switches off animation and transition inside the app under prefers-reduced-motion', () => {
    const start = indexCss.lastIndexOf('@media (prefers-reduced-motion: reduce)');
    expect(start).toBeGreaterThanOrEqual(0);
    const block = indexCss.slice(start);
    expect(block).toMatch(/\.ir-app \*,\s*\.ir-app \*::before,\s*\.ir-app \*::after/);
    expect(block).toMatch(/animation-duration:\s*0\.01ms !important/);
    expect(block).toMatch(/animation-iteration-count:\s*1 !important/);
    expect(block).toMatch(/transition-duration:\s*0\.01ms !important/);
    expect(block).toMatch(/scroll-behavior:\s*auto !important/);
  });
});
