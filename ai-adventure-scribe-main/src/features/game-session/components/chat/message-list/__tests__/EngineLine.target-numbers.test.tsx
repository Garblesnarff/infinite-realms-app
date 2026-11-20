/**
 * #157 client rows: the Engine line the player reads hides the AC or DC clause when the player's
 * "Show target numbers" setting is off. The server text that feeds the DM is not changed; these
 * rows assert only what is shown on screen.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { parseEngineLine } from '../engine-line-model';
import { EngineLine } from '../EngineLine';

const STORAGE_KEY = 'ui:showTargetNumbers:v1';

const CHECK_LINE = '⚙️ Engine: Persuasion: 21 (nat 20+1) vs DC 15 — success';
const ATTACK_LINE =
  '⚙️ Engine: Rook rolled 14 + 5 = 19 vs AC 12 against Goblin with Longsword — HIT.';

describe('Engine line shows target numbers only when the player wants them (#157)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('check line: the DC is on screen when the setting is on', () => {
    window.localStorage.setItem(STORAGE_KEY, 'on');
    render(<EngineLine model={parseEngineLine(CHECK_LINE)} />);
    expect(document.body.textContent).toContain('vs DC 15');
  });

  it('check line: the DC is never on screen when the setting is off', () => {
    window.localStorage.setItem(STORAGE_KEY, 'off');
    render(<EngineLine model={parseEngineLine(CHECK_LINE)} />);
    expect(document.body.textContent).not.toMatch(/DC \d|vs DC/);
    expect(document.body.textContent).toContain('success');
  });

  it('attack line: the AC is on screen when on, never when off', () => {
    window.localStorage.setItem(STORAGE_KEY, 'on');
    const { unmount } = render(<EngineLine model={parseEngineLine(ATTACK_LINE)} />);
    expect(document.body.textContent).toContain('AC 12');
    unmount();

    window.localStorage.setItem(STORAGE_KEY, 'off');
    render(<EngineLine model={parseEngineLine(ATTACK_LINE)} />);
    expect(document.body.textContent).not.toMatch(/AC \d|AC \?/);
    expect(screen.getByTestId('engine-line')).toBeInTheDocument();
  });
});
