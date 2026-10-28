/**
 * #1239 item 1: the session-start prompt's copy and controls. The decision
 * logic lives in use-session-rest-gate.test.ts; this file pins what the
 * player reads and what each button does.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SessionRestPrompt } from '../SessionRestPrompt';

describe('SessionRestPrompt (#1239)', () => {
  const props = {
    characterName: 'Sera Voss',
    currentHp: 2,
    maxHp: 10,
    resting: false,
    restError: null as string | null,
    onRestFirst: vi.fn(),
    onContinue: vi.fn(),
  };

  it('shows the hero at their carried HP and both choices', () => {
    render(<SessionRestPrompt {...props} />);
    expect(screen.getByRole('heading', { name: 'Rest first?' })).toBeTruthy();
    expect(screen.getByText('Sera Voss starts at 2/10 HP.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rest first?' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue as you are' })).toBeTruthy();
  });

  it('resting disables both buttons and names the wait', () => {
    render(<SessionRestPrompt {...props} resting />);
    expect(screen.getByRole('button', { name: 'Resting…' })).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Continue as you are' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('a rest error is shown and the choice stays open', () => {
    render(<SessionRestPrompt {...props} restError="rest refused" />);
    expect(screen.getByRole('alert').textContent).toContain('rest refused');
    expect(
      (screen.getByRole('button', { name: 'Rest first?' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('each button calls its handler', () => {
    const onRestFirst = vi.fn();
    const onContinue = vi.fn();
    render(<SessionRestPrompt {...props} onRestFirst={onRestFirst} onContinue={onContinue} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rest first?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue as you are' }));
    expect(onRestFirst).toHaveBeenCalledTimes(1);
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
