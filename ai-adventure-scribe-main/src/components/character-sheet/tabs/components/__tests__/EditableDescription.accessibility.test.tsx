import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import EditableDescription from '../EditableDescription';

const mockCharacter: any = {
  id: '1',
  name: 'Test Hero',
  bio: 'Initial bio',
};

const mockOnUpdate = vi.fn();

describe('EditableDescription Accessibility', () => {
  it('renders in read-only mode by default with correct accessibility attributes', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
      />
    );

    const displayArea = screen.getByTitle(/click to edit bio/i);
    expect(displayArea).toBeInTheDocument();
    expect(displayArea).toHaveAttribute('role', 'button');
    expect(displayArea).toHaveAttribute('tabindex', '0');
    expect(screen.getByText('Initial bio')).toBeInTheDocument();
  });

  it('enters edit mode on click', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
      />
    );

    const displayArea = screen.getByTitle(/click to edit bio/i);
    fireEvent.click(displayArea);

    expect(screen.getByPlaceholderText('Enter bio...')).toBeInTheDocument();
    expect(screen.getByLabelText(/save bio/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/cancel editing/i)).toBeInTheDocument();
  });

  it('enters edit mode on Enter key press', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
      />
    );

    const displayArea = screen.getByTitle(/click to edit bio/i);
    fireEvent.keyDown(displayArea, { key: 'Enter', code: 'Enter' });

    expect(screen.getByPlaceholderText('Enter bio...')).toBeInTheDocument();
  });

  it('enters edit mode on Space key press', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
      />
    );

    const displayArea = screen.getByTitle(/click to edit bio/i);
    fireEvent.keyDown(displayArea, { key: ' ', code: 'Space' });

    expect(screen.getByPlaceholderText('Enter bio...')).toBeInTheDocument();
  });

  it('has title tooltips on save and cancel buttons', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
      />
    );

    fireEvent.click(screen.getByTitle(/click to edit bio/i));

    expect(screen.getByTitle(/save bio/i)).toBeInTheDocument();
    expect(screen.getByTitle(/cancel editing/i)).toBeInTheDocument();
  });

  it('is not focusable when disabled', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
        disabled={true}
      />
    );

    const displayArea = screen.getByTitle(/click to edit bio/i);
    expect(displayArea).toHaveAttribute('tabindex', '-1');
  });

  it('handles Escape key to cancel', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
      />
    );

    fireEvent.click(screen.getByTitle(/click to edit bio/i));
    const textarea = screen.getByPlaceholderText('Enter bio...');
    fireEvent.change(textarea, { target: { value: 'New bio' } });
    fireEvent.keyDown(textarea, { key: 'Escape', code: 'Escape' });

    expect(screen.queryByPlaceholderText('Enter bio...')).not.toBeInTheDocument();
    expect(screen.getByText('Initial bio')).toBeInTheDocument();
  });

  it('handles Ctrl+Enter key to save', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
      />
    );

    fireEvent.click(screen.getByTitle(/click to edit bio/i));
    const textarea = screen.getByPlaceholderText('Enter bio...');
    fireEvent.change(textarea, { target: { value: 'New bio' } });
    fireEvent.keyDown(textarea, { key: 'Enter', code: 'Enter', ctrlKey: true });

    expect(mockOnUpdate).toHaveBeenCalledWith(expect.objectContaining({ bio: 'New bio' }));
    expect(screen.queryByPlaceholderText('Enter bio...')).not.toBeInTheDocument();
  });

  it('saves on Save button click', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
      />
    );

    fireEvent.click(screen.getByTitle(/click to edit bio/i));
    const textarea = screen.getByPlaceholderText('Enter bio...');
    fireEvent.change(textarea, { target: { value: 'Clicked Save' } });
    fireEvent.click(screen.getByLabelText(/save bio/i));

    expect(mockOnUpdate).toHaveBeenCalledWith(expect.objectContaining({ bio: 'Clicked Save' }));
  });

  it('cancels on Cancel button click', () => {
    render(
      <EditableDescription
        value="Initial bio"
        label="Bio"
        placeholder="Enter bio..."
        field="bio"
        character={mockCharacter}
        onUpdate={mockOnUpdate}
      />
    );

    fireEvent.click(screen.getByTitle(/click to edit bio/i));
    const textarea = screen.getByPlaceholderText('Enter bio...');
    fireEvent.change(textarea, { target: { value: 'Cancelled' } });
    fireEvent.click(screen.getByLabelText(/cancel editing/i));

    expect(screen.getByText('Initial bio')).toBeInTheDocument();
  });
});
