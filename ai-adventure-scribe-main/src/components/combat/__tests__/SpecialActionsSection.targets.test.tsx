/**
 * #621 B2b step 2: Grapple and Shove need a target. With no enemy selected they are disabled, so
 * no action is sent without one. The server check intent takes the target.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SpecialActionsSection } from '../SpecialActionsSection';

const fighter = {
  id: 'p1',
  name: 'Fighter',
  characterClass: 'fighter',
  spellSlots: {},
} as never;

const renderSection = (selectedEnemyId: string | null, onCombatAction = vi.fn()) =>
  render(
    <SpecialActionsSection
      currentParticipant={fighter}
      selectedEnemyId={selectedEnemyId}
      onCombatAction={onCombatAction}
      onEnhancedAttack={vi.fn()}
    />,
  );

describe('SpecialActionsSection Grapple and Shove need a target (#621 B2b step 2)', () => {
  it('disables Grapple and Shove when no enemy is selected', () => {
    renderSection(null);

    expect(screen.getByRole('button', { name: 'Grapple' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Shove' })).toBeDisabled();
  });

  it('enables Grapple and Shove when an enemy is selected', () => {
    renderSection('enemy-1');

    expect(screen.getByRole('button', { name: 'Grapple' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Shove' })).toBeEnabled();
  });

  it('sends Grapple against the selected enemy', () => {
    const onCombatAction = vi.fn();
    renderSection('enemy-1', onCombatAction);

    fireEvent.click(screen.getByRole('button', { name: 'Grapple' }));

    expect(onCombatAction).toHaveBeenCalledWith('grapple', 'p1', 'enemy-1');
  });
});
