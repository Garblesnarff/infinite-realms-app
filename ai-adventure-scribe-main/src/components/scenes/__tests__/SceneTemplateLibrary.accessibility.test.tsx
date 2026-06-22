import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SceneTemplateLibrary } from '../SceneTemplateLibrary';
import '@testing-library/jest-dom';

describe('SceneTemplateLibrary Accessibility', () => {
  it('has accessible search input and filter controls', () => {
    render(<SceneTemplateLibrary />);

    // Check search input
    const searchInput = screen.getByLabelText(/search scene templates/i);
    expect(searchInput).toBeInTheDocument();
    expect(searchInput).toHaveAttribute('placeholder', 'Search templates...');

    // Check filter group
    const filterGroup = screen.getByRole('group', { name: /filter templates by category/i });
    expect(filterGroup).toBeInTheDocument();

    // Check "All" button
    const allButton = screen.getByRole('button', { name: /show all templates/i });
    expect(allButton).toHaveAttribute('aria-pressed', 'true');

    // Check a category button
    const interiorButton = screen.getByRole('button', { name: /show interior templates/i });
    expect(interiorButton).toHaveAttribute('aria-pressed', 'false');

    // Click category button and verify state change
    fireEvent.click(interiorButton);
    expect(interiorButton).toHaveAttribute('aria-pressed', 'true');
    expect(allButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('has accessible template selection radios in a radiogroup', () => {
    const onSelectTemplate = vi.fn();
    render(<SceneTemplateLibrary onSelectTemplate={onSelectTemplate} />);

    // Check radiogroup
    const radiogroup = screen.getByRole('radiogroup', { name: /scene templates/i });
    expect(radiogroup).toBeInTheDocument();

    // Find all radio options
    const radioOptions = screen.getAllByRole('radio');
    expect(radioOptions.length).toBeGreaterThan(0);

    const firstRadio = radioOptions[0];
    expect(firstRadio).toHaveAttribute('aria-checked', 'false');
    expect(firstRadio).toHaveAttribute('tabIndex', '0');

    // Click the radio card
    fireEvent.click(firstRadio);
    expect(onSelectTemplate).toHaveBeenCalled();
  });

  it('supports keyboard interaction (Space and Enter) on template cards', () => {
    const onSelectTemplate = vi.fn();
    render(<SceneTemplateLibrary onSelectTemplate={onSelectTemplate} />);

    const radioOptions = screen.getAllByRole('radio');
    const firstRadio = radioOptions[0];

    // Space key
    fireEvent.keyDown(firstRadio, { key: ' ', code: 'Space' });
    expect(onSelectTemplate).toHaveBeenCalledTimes(1);

    // Enter key
    fireEvent.keyDown(firstRadio, { key: 'Enter', code: 'Enter' });
    expect(onSelectTemplate).toHaveBeenCalledTimes(2);
  });

  it('shows selected state correctly when selectedTemplateId is provided', () => {
    render(<SceneTemplateLibrary selectedTemplateId="tavern" />);

    // The Tavern radio should be in checked state
    const tavernRadio = screen.getByRole('radio', { name: /tavern interior/i });
    expect(tavernRadio).toBeInTheDocument();
    expect(tavernRadio).toHaveAttribute('aria-checked', 'true');
  });
});
