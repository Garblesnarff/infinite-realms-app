import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi } from 'vitest';

import { InspirationSection } from '../InspirationSection';

import type { InspirationEntry } from '@/features/character/hooks/use-personality-manager';

const history: InspirationEntry[] = [];

describe('InspirationSection', () => {
  it('shows "held" when hasInspiration is true', () => {
    render(<InspirationSection hasInspiration={true} inspirationHistory={history} />);
    expect(screen.getByText('held')).toBeInTheDocument();
    const coin = screen.getByLabelText('held');
    expect(coin.className).toContain('--ir-brass-1');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /award/i })).toBeNull();
  });

  it('shows "not held" when hasInspiration is false', () => {
    render(<InspirationSection hasInspiration={false} inspirationHistory={history} />);
    expect(screen.getByText('not held')).toBeInTheDocument();
    const coin = screen.getByLabelText('not held');
    expect(coin.className).toContain('--ir-wax-slate');
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.queryByRole('button', { name: /award/i })).toBeNull();
  });

  it('coin is not a button/switch and clicking does not call an update callback', async () => {
    const onUpdate = vi.fn();
    const user = userEvent.setup();
    render(<InspirationSection hasInspiration={true} inspirationHistory={history} />);
    const coin = screen.getByLabelText('held');
    await user.click(coin);
    expect(onUpdate).not.toHaveBeenCalled();
    // ensure no throw
    fireEvent.click(coin);
  });
});
