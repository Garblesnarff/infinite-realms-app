import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CombatActionBar } from '../CombatActionBar';

import type { LegalAction } from '@/features/game-session/hooks/use-combat-legal-actions';

/**
 * #1642: the small arrow beside Attack is `attacks.length > 1` from the
 * server legal-actions list. With 10 ft of movement and a foe 25 ft away,
 * that list is only the Javelin, so the chevron must not show. It will
 * still show if the bar is holding a stale list (Longsword + Javelin)
 * from before the move.
 */
const javelin: LegalAction = {
  type: 'attack',
  label: 'Attack with Javelin',
  weaponId: 'javelin',
  targetIds: ['foe-1'],
};
const longsword: LegalAction = {
  type: 'attack',
  label: 'Attack with Longsword (move closer first)',
  weaponId: 'longsword',
  targetIds: ['foe-1'],
};

const barProps = {
  enabled: true,
  hasSpells: false,
  nameOf: (id: string) => (id === 'foe-1' ? 'the foe' : id),
  moveSub: '10 ft',
  canMove: true,
  onAction: vi.fn(),
  onMove: vi.fn(),
};

describe('CombatActionBar weapon chevron (#1642)', () => {
  it('hides the arrow when the legal list is only the Javelin', () => {
    render(<CombatActionBar {...barProps} actions={[javelin]} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    expect(within(toolbar).getByRole('button', { name: /^Attack/ })).toBeInTheDocument();
    expect(
      within(toolbar).queryByRole('button', { name: 'Other weapons and targets' }),
    ).not.toBeInTheDocument();
    expect(within(toolbar).getByText('10 ft')).toBeInTheDocument();
  });

  it('shows the arrow when a stale list still has the Longsword and the Javelin', () => {
    render(<CombatActionBar {...barProps} actions={[longsword, javelin]} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Your actions' });
    expect(
      within(toolbar).getByRole('button', { name: 'Other weapons and targets' }),
    ).toBeInTheDocument();
    expect(within(toolbar).getByText('10 ft')).toBeInTheDocument();
  });
});
