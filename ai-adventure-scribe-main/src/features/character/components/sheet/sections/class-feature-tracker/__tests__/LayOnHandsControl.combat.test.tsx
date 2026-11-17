import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LayOnHandsControl } from '../LayOnHandsControl';

import { InCombatFlagContext } from '@/contexts/in-combat-flag';

vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/services/user-data-api', () => ({ userDataApi: { layOnHands: vi.fn() } }));

// #1554: the sheet's Lay on Hands control steps aside while the game is in combat, because the
// Lay on Hands there is an Action from the combat actions, not a free sheet heal.
describe('LayOnHandsControl in combat (#1554)', () => {
  it('hides the heal and cure buttons during a fight and points to the combat actions', () => {
    render(
      <InCombatFlagContext.Provider value={true}>
        <LayOnHandsControl characterId="char-1" pool={5} />
      </InCombatFlagContext.Provider>,
    );
    expect(screen.queryByRole('button', { name: 'Heal self' })).toBeNull();
    expect(screen.queryByRole('button', { name: /cure/i })).toBeNull();
    expect(screen.queryByLabelText('Lay on Hands points to spend')).toBeNull();
    expect(
      screen.getByText('In combat, use Lay on Hands from the combat actions.'),
    ).toBeInTheDocument();
  });

  it('shows the heal and cure controls out of combat', () => {
    render(
      <InCombatFlagContext.Provider value={false}>
        <LayOnHandsControl characterId="char-1" pool={5} />
      </InCombatFlagContext.Provider>,
    );
    expect(screen.getByRole('button', { name: 'Heal self' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cure poison (5)' })).toBeInTheDocument();
    expect(screen.queryByText(/In combat/)).toBeNull();
  });
});
