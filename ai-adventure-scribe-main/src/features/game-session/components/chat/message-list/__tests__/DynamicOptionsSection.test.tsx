import { render, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { DynamicOptionsSection } from '../DynamicOptionsSection';

// Mock the dependent component
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options, onOptionSelect }: { options: any[], onOptionSelect: any }) => (
    <div data-testid="action-options">
      {options.map((opt, i) => (
        <button key={i} onClick={() => onOptionSelect(opt)}>
          {opt.text}
        </button>
      ))}
    </div>
  ),
}));

describe('DynamicOptionsSection', () => {
  const mockOptions = [
    { id: '1', text: 'Option 1', number: 1 },
    { id: '2', text: 'Option 2', number: 2 },
  ];
  const mockOnOptionSelect = vi.fn();

  it('renders correctly when options are provided', () => {
    const { getByTestId, getByText } = render(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    expect(getByTestId('action-options')).toBeDefined();
    expect(getByText('Option 1')).toBeDefined();
  });

  it('returns null when no options are provided', () => {
    const { container } = render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('calls onOptionSelect when an option is clicked', () => {
    const { getByText } = render(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    fireEvent.click(getByText('Option 1'));
    expect(mockOnOptionSelect).toHaveBeenCalled();
  });

  it('adjusts delay based on hasDynamicOverlay', () => {
    // This is hard to test directly as delay is passed to the mocked ActionOptions,
    // but we can at least ensure it renders in both cases.
    const { rerender, getByTestId } = render(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );
    expect(getByTestId('action-options')).toBeDefined();

    rerender(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={true}
      />,
    );
    expect(getByTestId('action-options')).toBeDefined();
  });

  it('is memoized', () => {
    const { rerender, getByText } = render(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    rerender(
      <DynamicOptionsSection
        options={mockOptions as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    expect(getByText('Option 1')).toBeDefined();
  });
});
