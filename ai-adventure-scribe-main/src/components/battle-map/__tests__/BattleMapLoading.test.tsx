import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect } from 'vitest';

import { BattleMapLoading } from '../BattleMapLoading';

describe('BattleMapLoading Accessibility', () => {
  it('renders with role="status" and aria-live="polite"', () => {
    render(<BattleMapLoading />);

    const container = screen.getByRole('status');
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute('aria-live', 'polite');
  });

  it('contains the screen reader announcement', () => {
    render(<BattleMapLoading />);

    const srAnnouncement = screen.getByText('Loading battle map...');
    expect(srAnnouncement).toBeInTheDocument();
    expect(srAnnouncement).toHaveClass('sr-only');
  });

  it('hides visual skeleton elements from assistive technologies', () => {
    const { container } = render(<BattleMapLoading />);

    // Find children elements that should be hidden
    const hiddenElements = container.querySelectorAll('[aria-hidden="true"]');
    expect(hiddenElements.length).toBeGreaterThanOrEqual(2);
  });
});
