/**
 * #1797: the small arrow beside Attack lists the other weapons. It waits while the legal-action
 * list is being re-read after a move, so it never offers a list from before the move.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CombatActionBar } from '../CombatActionBar';

import type { LegalAction } from '@/features/game-session/hooks/use-combat-legal-actions';

const longsword: LegalAction = {
  type: 'attack',
  label: 'Attack with Longsword',
  weaponId: 'longsword',
  targetIds: ['goblin-1'],
};
const javelin: LegalAction = {
  type: 'attack',
  label: 'Attack with Javelin',
  weaponId: 'javelin',
  targetIds: ['goblin-1'],
};
const props = {
  actions: [longsword, javelin],
  enabled: true,
  hasSpells: false,
  nameOf: (id: string) => id,
  canMove: false,
  spellInfo: () => null,
  onAction: vi.fn(),
  onMove: vi.fn(),
};
const ARROW = 'Other weapons and targets';

describe('CombatActionBar weapon arrow (#1797)', () => {
  it('shows the arrow when the list has more than one attack and is settled', () => {
    render(<CombatActionBar {...props} listRefreshing={false} />);
    expect(screen.getByRole('button', { name: ARROW })).toBeInTheDocument();
  });

  it('hides the arrow while the list is being re-read, then shows it on the fresh list', () => {
    const { rerender } = render(<CombatActionBar {...props} listRefreshing />);
    expect(screen.queryByRole('button', { name: ARROW })).not.toBeInTheDocument();
    rerender(<CombatActionBar {...props} listRefreshing={false} />);
    expect(screen.getByRole('button', { name: ARROW })).toBeInTheDocument();
  });
});
