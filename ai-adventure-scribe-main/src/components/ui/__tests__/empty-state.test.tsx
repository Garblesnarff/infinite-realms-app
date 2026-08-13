import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect } from 'vitest';

import { EmptyState } from '../empty-state';

describe('EmptyState', () => {
  it('renders with aria-hidden on the icon container', () => {
    render(<EmptyState title="No items" description="Nothing here" />);

    // The icon container has aria-hidden="true"
    // We can find it by looking for the motion.div which wraps the icon.
    // Since it's aria-hidden, we need to find it differently or just check the container.

    const title = screen.getByText('No items');
    const container = title.parentElement;
    const iconContainer = container?.querySelector('div[aria-hidden="true"]');

    expect(iconContainer).toBeDefined();
    expect(iconContainer?.getAttribute('aria-hidden')).toBe('true');
  });
});
