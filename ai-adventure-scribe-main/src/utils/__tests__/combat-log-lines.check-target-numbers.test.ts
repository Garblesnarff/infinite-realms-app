/**
 * #157 client rows: the tracker log shows the same engine lines as chat. With "Show target numbers"
 * off, a line with no card loses its "vs DC N" by text; with it on, the number stays.
 */
import { describe, expect, it } from 'vitest';

import { combatLogLines } from '../combat-log-lines';

const CHECK_LINE = '⚙️ Engine: Persuasion: 21 (nat 20+1) vs DC 15 — success, nothing changes';

const systemLine = (text: string) =>
  ({
    id: 'm1',
    sender: 'system',
    text,
    timestamp: '2026-11-17T00:00:00Z',
  }) as never;

describe('combat tracker log follows showTargetNumbers (#157)', () => {
  it('keeps the DC when on', () => {
    const lines = combatLogLines([systemLine(CHECK_LINE)], 20, true);
    expect(lines.join('\n')).toContain('vs DC 15');
  });

  it('drops the DC when off, and keeps the outcome word', () => {
    const lines = combatLogLines([systemLine(CHECK_LINE)], 20, false);
    expect(lines.join('\n')).not.toMatch(/vs DC|DC \d/);
    expect(lines.join('\n')).toContain('success');
  });
});
