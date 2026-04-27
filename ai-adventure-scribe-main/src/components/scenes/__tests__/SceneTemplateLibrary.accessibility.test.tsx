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
    const allButton = screen.getByRole('button', { name: /^all$/i });
    expect(allButton).toHaveAttribute('aria-pressed', 'true');
    expect(allButton).toHaveAttribute('title', 'Show all templates');

    // Check a category button
    const interiorButton = screen.getByRole('button', { name: /interior/i });
    expect(interiorButton).toHaveAttribute('aria-pressed', 'false');
    expect(interiorButton).toHaveAttribute('title', 'Show interior templates');

    // Click category button and verify state change
    fireEvent.click(interiorButton);
    expect(interiorButton).toHaveAttribute('aria-pressed', 'true');
    expect(allButton).toHaveAttribute('aria-pressed', 'false');
  });

  it('has accessible template selection buttons', () => {
    const onSelectTemplate = vi.fn();
    render(<SceneTemplateLibrary onSelectTemplate={onSelectTemplate} />);

    // Find all "Use Template" buttons
    const selectionButtons = screen.getAllByRole('button', { name: /use this template/i });
    expect(selectionButtons.length).toBeGreaterThan(0);

    const firstButton = selectionButtons[0];
    expect(firstButton).toHaveAttribute('aria-pressed', 'false');
    expect(firstButton).toHaveAttribute('title', 'Use this template');

    // Click the button
    fireEvent.click(firstButton);
    expect(onSelectTemplate).toHaveBeenCalled();
  });

  it('shows selected state correctly when selectedTemplateId is provided', () => {
    render(<SceneTemplateLibrary selectedTemplateId="tavern" />);

    // The Tavern button should be in selected state
    const tavernButton = screen.getByRole('button', { name: /template selected/i });
    expect(tavernButton).toBeInTheDocument();
    expect(tavernButton).toHaveAttribute('aria-pressed', 'true');
    expect(tavernButton).toHaveAttribute('title', 'Template selected');
  });
});
