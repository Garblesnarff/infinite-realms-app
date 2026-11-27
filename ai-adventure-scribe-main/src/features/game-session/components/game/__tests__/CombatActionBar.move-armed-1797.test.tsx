/**
 * #1797: the Move button reads as pressed only while Move mode is armed on the map. The map sets
 * the flag; a turn change clears it, so the button can't look armed when a click would do nothing.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { CombatActionBar } from '../CombatActionBar';

import type { LegalAction } from '@/features/game-session/hooks/use-combat-legal-actions';

const moveAction: LegalAction = { type: 'move', label: 'Move (30 ft remaining)', x: 3, y: 4 };
const props = {
  actions: [moveAction],
  enabled: true,
  hasSpells: false,
  nameOf: (id: string) => id,
  moveSub: '30 ft',
  canMove: true,
  spellInfo: () => null,
  onAction: vi.fn(),
  onMove: vi.fn(),
};

describe('CombatActionBar Move button (#1797)', () => {
  it('reads as not pressed when Move mode is not armed', () => {
    render(<CombatActionBar {...props} />);
    expect(screen.getByRole('button', { name: /^Move/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('reads as pressed while Move mode is armed, and still opens it on a press', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<CombatActionBar {...props} moveArmed />);
    const move = screen.getByRole('button', { name: /^Move/ });
    expect(move).toHaveAttribute('aria-pressed', 'true');
    rerender(<CombatActionBar {...props} moveArmed={false} />);
    expect(screen.getByRole('button', { name: /^Move/ })).toHaveAttribute('aria-pressed', 'false');
    await user.click(screen.getByRole('button', { name: /^Move/ }));
    expect(props.onMove).toHaveBeenCalledTimes(1);
  });
});
