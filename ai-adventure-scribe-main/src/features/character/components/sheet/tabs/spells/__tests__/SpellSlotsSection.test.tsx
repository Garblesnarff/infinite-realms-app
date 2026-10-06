import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { TooltipProvider } from '@/components/ui/tooltip';
import SpellSlotsSection from '@/features/character/components/sheet/tabs/spells/SpellSlotsSection';

function renderSection(overrides: Partial<React.ComponentProps<typeof SpellSlotsSection>> = {}) {
  return render(
    <TooltipProvider delayDuration={300}>
      <SpellSlotsSection
        spellSlots={{ 1: { total: 4, used: 2 }, 2: { total: 3, used: 0 } }}
        longRest={vi.fn()}
        resting={false}
        restError={null}
        {...overrides}
      />
    </TooltipProvider>,
  );
}

describe('SpellSlotsSection', () => {
  it('renders slot pips as non-interactive indicators, not buttons', () => {
    const { container } = renderSection();

    // The pips show used/max from the character record. They must not be
    // clickable: pip clicks used to flip local-only state that reverted on
    // reload — a second slot-usage store beside the engine table.
    const pipButtons = Array.from(container.querySelectorAll('button')).filter((button) =>
      /^level \d+ spell slot/i.test(button.getAttribute('aria-label') ?? ''),
    );
    expect(pipButtons).toHaveLength(0);

    // The indicators still render with their state labels (2 expended at
    // level 1, 3 available at level 2)
    expect(
      screen.getAllByRole('img', { name: 'Level 1 spell slot expended' }),
    ).toHaveLength(2);
    expect(
      screen.getAllByRole('img', { name: 'Level 2 spell slot available' }),
    ).toHaveLength(3);

    // And the counts still show
    expect(screen.getByText('2 / 4 remaining')).toBeInTheDocument();
    expect(screen.getByText('3 / 3 remaining')).toBeInTheDocument();
  });

  it('shows the long-rest failure inline instead of a page error screen', () => {
    renderSection({ restError: 'network down' });

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Long rest failed: network down');
  });

  it('disables Long Rest while a rest is in flight', () => {
    renderSection({ resting: true });

    expect(
      screen.getByRole('button', { name: 'Recover all spell slots and sorcery points' }),
    ).toBeDisabled();
    expect(screen.getByText('Resting…')).toBeInTheDocument();
  });
});
