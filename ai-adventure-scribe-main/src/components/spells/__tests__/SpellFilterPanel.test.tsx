import { render, screen, within } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import SpellFilterPanel, { SpellFilters } from '../SpellFilterPanel';

describe('SpellFilterPanel Tooltips', () => {
  const mockFilters: SpellFilters = {
    schools: [],
    components: {
      verbal: false,
      somatic: false,
      material: false,
    },
    properties: {
      concentration: false,
      ritual: false,
      damage: false,
    },
  };

  const mockOnChange = () => {};
  const availableSchools = ['Abjuration', 'Evocation'];

  it('should have Tooltip for school badges', async () => {
    render(
      <SpellFilterPanel
        filters={mockFilters}
        onChange={mockOnChange}
        availableSchools={availableSchools}
      />
    );

    // Badges should now have aria-label and no title
    const abjurationBadge = screen.getByLabelText('Filter by Abjuration');
    expect(abjurationBadge).toBeInTheDocument();
    expect(abjurationBadge).not.toHaveAttribute('title');
  });

  it('should have Tooltip for active filter badges', () => {
    const activeFilters = {
      ...mockFilters,
      schools: ['Abjuration'],
    };

    render(
      <SpellFilterPanel
        filters={activeFilters}
        onChange={mockOnChange}
        availableSchools={availableSchools}
      />
    );

    // Active filter badge should have aria-label and no title
    // In SpellFilterPanel, active filter badges have aria-label={`Remove ${school} filter`}
    const removeBadge = screen.getByLabelText('Remove Abjuration filter');
    expect(removeBadge).toBeInTheDocument();
    expect(removeBadge).not.toHaveAttribute('title');
  });
});
