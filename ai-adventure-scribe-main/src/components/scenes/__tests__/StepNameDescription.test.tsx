import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { StepNameDescription } from '../scene-creation-wizard/StepNameDescription';

describe('StepNameDescription Accessibility', () => {
  it('renders with unique IDs and correctly linked labels', () => {
    const onUpdate = vi.fn();
    const { rerender } = render(
      <StepNameDescription
        name=""
        description=""
        onUpdate={onUpdate}
      />
    );

    // Check Scene Name input
    const nameLabel = screen.getByText(/Scene Name \*/i);
    const nameInput = screen.getByLabelText(/Scene Name \*/i);

    expect(nameInput).toBeInTheDocument();
    expect(nameInput.tagName).toBe('INPUT');
    expect(nameInput).toHaveAttribute('id');
    expect(nameLabel).toHaveAttribute('for', nameInput.id);

    // Check Description textarea
    const descLabel = screen.getByText(/Description \(Optional\)/i);
    const descTextarea = screen.getByLabelText(/Description \(Optional\)/i);

    expect(descTextarea).toBeInTheDocument();
    expect(descTextarea.tagName).toBe('TEXTAREA');
    expect(descTextarea).toHaveAttribute('id');
    expect(descLabel).toHaveAttribute('for', descTextarea.id);

    // Verify IDs are unique
    expect(nameInput.id).not.toBe(descTextarea.id);

    // Rerender should keep IDs stable if component is same, but different instances get different IDs
    const { container: container2 } = render(
      <StepNameDescription
        name=""
        description=""
        onUpdate={onUpdate}
      />
    );
    const nameInput2 = container2.querySelector('input');
    expect(nameInput2?.id).not.toBe(nameInput.id);
  });
});
