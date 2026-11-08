import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/features/game-session/components/game/chronicle/chronicle.css'),
  'utf8',
);

const BRASS_BUTTON_SELECTORS = [
  '.ir-chronicle-share',
  '.ir-chronicle-write',
  '.ir-chronicle-upgrade-button',
  '.ir-chronicle-aside-play',
] as const;

const BANNED_IN_BACKGROUND = ['#a9823f', '#6e5226', '--ir-brass-3', '--ir-brass-4'] as const;

function extractRules(source: string): Array<{ selector: string; body: string }> {
  const rules: Array<{ selector: string; body: string }> = [];
  const pattern = /([^{};]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const selector = match[1].trim();
    const body = match[2];
    if (selector.startsWith('@')) continue;
    rules.push({ selector, body });
  }
  return rules;
}

function splitSelectorList(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const char of selector) {
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function backgroundDeclarations(body: string): string[] {
  const declarations: string[] = [];
  const pattern = /background\s*:([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(body)) !== null) {
    declarations.push(match[1].toLowerCase());
  }
  return declarations;
}

describe('chronicle.css', () => {
  const rules = extractRules(css);

  it('scopes every chronicle page and dialog selector under body.ir-table-look', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      for (const part of splitSelectorList(rule.selector)) {
        if (part.includes('.ir-chronicle-page') || part.includes('.ir-chronicle-dialog')) {
          expect(part.startsWith('body.ir-table-look')).toBe(true);
        }
      }
    }
    expect(css).toContain('prefers-reduced-motion: reduce');
  });

  it('keeps brass button backgrounds on the high-contrast gradient', () => {
    let found = 0;
    for (const rule of rules) {
      const isBrassButton = splitSelectorList(rule.selector).some((part) =>
        BRASS_BUTTON_SELECTORS.some((needle) => part.includes(needle)),
      );
      if (!isBrassButton) continue;
      for (const declaration of backgroundDeclarations(rule.body)) {
        found += 1;
        for (const banned of BANNED_IN_BACKGROUND) {
          expect(declaration).not.toContain(banned);
        }
        expect(declaration).toContain('var(--ir-brass-1)');
        expect(declaration).toContain('var(--ir-brass-2)');
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it('uses existing --ir-* tokens instead of hardcoded hexes', () => {
    expect(css).not.toContain('#e6c98f');
    expect(css).not.toContain('#121b30');
    expect(css).not.toContain('#4fb6c4');
    expect(css).toContain('var(--ir-felt-1)');
    expect(css).toContain('var(--ir-steel-text)');
  });
});
