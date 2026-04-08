import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import { MultiSelect } from '../multi-select';

describe('MultiSelect Accessibility', () => {
  const options = [
    { value: '1', label: 'Option 1' },
    { value: '2', label: 'Option 2' },
  ];

  it('adds aria-label and title to the remove button in badges', () => {
    render(<MultiSelect options={options} value={['1']} onChange={() => {}} />);

    const removeButton = screen.getByRole('button', { name: /remove option 1/i });
    expect(removeButton).toBeInTheDocument();
    expect(removeButton).toHaveAttribute('title', 'Remove Option 1');
  });

  it('handles item selection and unselection', async () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={['1']} onChange={onChange} />);

    // Unselect via badge button
    const removeButton = screen.getByRole('button', { name: /remove option 1/i });
    fireEvent.click(removeButton);
    expect(onChange).toHaveBeenCalledWith([]);

    // Open popover
    const trigger = screen.getByRole('combobox');
    fireEvent.click(trigger);

    // Select second option - using getAllByText and picking the one that is NOT in the trigger area if possible,
    // or just using the role if available.
    // CommandItem has role="option"
    const option2 = screen.getByRole('option', { name: /Option 2/i });
    fireEvent.click(option2);
    expect(onChange).toHaveBeenCalledWith(['1', '2']);

    // Unselect via handleSelect (toggle branch)
    const option1 = screen.getByRole('option', { name: /Option 1/i });
    fireEvent.click(option1);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('handles badge click unselection', () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={['1']} onChange={onChange} />);

    // The badge text is 'Option 1'
    // Let's find the text element that is NOT the button
    const badgeText = screen.getByText('Option 1');
    const badge = badgeText.closest('.mr-1'); // Based on the class 'mr-1' on Badge
    if (badge) fireEvent.click(badge);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('handles keyboard navigation', () => {
    const onChange = vi.fn();
    render(<MultiSelect options={options} value={['1']} onChange={onChange} />);

    const removeButton = screen.getByRole('button', { name: /remove option 1/i });
    fireEvent.keyDown(removeButton, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith([]);

    // Test with a key that is NOT Enter
    fireEvent.keyDown(removeButton, { key: 'Escape' });
    // onChange should not have been called again (total 1 call)
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('handles mouse down and stop propagation', () => {
    render(<MultiSelect options={options} value={['1']} onChange={() => {}} />);
    const removeButton = screen.getByRole('button', { name: /remove option 1/i });

    // We can't easily check stopPropagation with fireEvent unless we wrap it
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    const spy = vi.spyOn(event, 'stopPropagation');
    removeButton.dispatchEvent(event);
    expect(spy).toHaveBeenCalled();
  });

  it('renders placeholder when empty', () => {
    render(<MultiSelect options={options} value={[]} onChange={() => {}} placeholder="Test Placeholder" />);
    expect(screen.getByText('Test Placeholder')).toBeInTheDocument();
  });
});
