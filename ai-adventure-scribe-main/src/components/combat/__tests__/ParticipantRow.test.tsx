import { readFileSync } from 'node:fs';
import path from 'node:path';

import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import { ParticipantRow } from '../ParticipantRow';

import type { CombatParticipant } from '@/types/combat';

import { TooltipProvider } from '@/components/ui/tooltip';

type Rgb = [number, number, number];

const THEME_CSS = readFileSync(path.resolve(__dirname, '../../../styles/ir-overhaul.css'), 'utf8');

/** Reads `--name: r g b` or `--name: rgba(r, g, b, a)` from the game theme (`.ir-app`). */
function token(name: string): { rgb: Rgb; alpha: number } {
  const match = THEME_CSS.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!match) throw new Error(`theme token --${name} not found`);
  const nums = match[1].match(/[\d.]+/g)?.map(Number) ?? [];
  return { rgb: [nums[0], nums[1], nums[2]], alpha: nums[3] ?? 1 };
}

const over = (top: Rgb, alpha: number, bottom: Rgb): Rgb =>
  top.map((channel, i) => channel * alpha + bottom[i] * (1 - alpha)) as Rgb;

const luminance = ([r, g, b]: Rgb): number => {
  const [lr, lg, lb] = [r, g, b].map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
};

const contrast = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const player = {
  id: 'pc',
  name: 'The Apprentice',
  participantType: 'player',
  initiative: 6,
  armorClass: 12,
  currentHitPoints: 5,
  maxHitPoints: 7,
  temporaryHitPoints: 0,
  conditions: [],
  deathSaves: { successes: 0, failures: 0 },
} as unknown as CombatParticipant;

const renderRow = (isCurrentTurn: boolean): HTMLElement => {
  render(
    <TooltipProvider>
      <ParticipantRow participant={player} isCurrentTurn={isCurrentTurn} roundNumber={1} />
    </TooltipProvider>,
  );
  return screen.getByTestId('participant-row');
};

describe('ParticipantRow (#2257)', () => {
  it('is not clickable: no button role, no tab stop, no pointer cursor', () => {
    const row = renderRow(true);
    expect(row).not.toHaveAttribute('role');
    expect(row).not.toHaveAttribute('tabindex');
    expect(row.className).not.toContain('cursor-pointer');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('marks the current turn with the gold tint and foreground text, not the pale amber fill', () => {
    const row = renderRow(true);
    expect(row.className).toContain('bg-infinite-gold/10');
    expect(row.className).toContain('outline-infinite-gold/45');
    expect(row.className).toContain('text-foreground');
    expect(row.className).not.toMatch(/bg-amber-50|rgb\(255,\s*251,\s*235\)/);
    expect(row).toHaveAttribute('aria-current', 'true');
  });

  it('gives the current-turn row AA contrast (4.5:1) for its text on the game theme', () => {
    const background = token('background').rgb;
    const gold = token('c-infinite-gold').rgb;
    const rowBackground = over(gold, 0.1, background);

    const foreground = token('foreground').rgb;
    expect(contrast(foreground, rowBackground)).toBeGreaterThanOrEqual(4.5);

    const muted = token('muted-foreground');
    expect(
      contrast(over(muted.rgb, muted.alpha, rowBackground), rowBackground),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('shows why the old pale row failed: light foreground on #fffbeb is about 1.1:1', () => {
    const ratio = contrast(token('foreground').rgb, [255, 251, 235]);
    expect(ratio).toBeLessThan(1.5);
  });
});

describe('ParticipantRow: the dying state (#2518)', () => {
  const renderPlayer = (overrides: Record<string, unknown>): void => {
    render(
      <TooltipProvider>
        <ParticipantRow
          participant={{ ...player, ...overrides } as unknown as CombatParticipant}
          isCurrentTurn={false}
          roundNumber={1}
        />
      </TooltipProvider>,
    );
  };

  it('a dying player reads UNCONSCIOUS in words, with the death save pips the server counted', () => {
    renderPlayer({
      currentHitPoints: 0,
      isUnconscious: true,
      deathSaves: { successes: 1, failures: 2 },
    });

    expect(screen.getByTestId('participant-vital-badge').textContent).toBe('Unconscious');
    expect(screen.getByLabelText('Death saves: 1 successes, 2 failures')).toBeTruthy();
  });

  it('a stable player reads Stable and shows no more death saves', () => {
    renderPlayer({
      currentHitPoints: 0,
      isUnconscious: true,
      isStable: true,
      deathSaves: { successes: 3, failures: 0 },
    });

    expect(screen.getByTestId('participant-vital-badge').textContent).toBe('Stable');
    expect(screen.queryByLabelText(/Death saves:/)).toBeNull();
  });

  it('a dead player reads Dead', () => {
    renderPlayer({
      currentHitPoints: 0,
      isUnconscious: true,
      isDead: true,
      deathSaves: { successes: 0, failures: 3 },
    });

    expect(screen.getByTestId('participant-vital-badge').textContent).toBe('Dead');
  });

  it('a player on their feet carries no state badge', () => {
    renderPlayer({});

    expect(screen.queryByTestId('participant-vital-badge')).toBeNull();
  });
});
