import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EngineLine } from '../EngineLine';

describe('EngineLine', () => {
  it('one pill per row', () => {
    render(
      <EngineLine line="⚙️ Engine: The Scholar rolled 14 + 0 = 14 vs AC 11 against Captain Sarah Reeves with Longsword — HIT. 3 slashing damage." />,
    );
    const row = screen.getByTestId('engine-line');
    expect(row.querySelectorAll('span').length).toBeGreaterThan(0);
    // pill text
    expect(screen.getByText('Hit')).toBeTruthy();
  });

  it('NPC row teal badge class', () => {
    render(
      <EngineLine line="⚙️ Engine: Captain Sarah Reeves rolled 14 + 0 = 14 vs AC 11 against The Scholar with Longsword — HIT. 3 slashing damage. The Scholar is now at 4 HP and is wounded." />,
    );
    const badge = screen.getByText('14');
    expect(badge.className).toContain('bg-infinite-teal');
  });

  it('Enter and Space toggle aria-expanded and raw line', () => {
    render(
      <EngineLine line="⚙️ Engine: The Scholar rolled 14 + 0 = 14 vs AC 11 against Captain Sarah Reeves with Longsword — HIT. 3 slashing damage." />,
    );
    const btn = screen.getByTestId('engine-line');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText(/rolled 14 \+ 0 = 14 vs AC 11/)).toBeNull();

    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/rolled 14 \+ 0 = 14 vs AC 11/)).toBeTruthy();

    fireEvent.keyDown(btn, { key: ' ' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });
});
