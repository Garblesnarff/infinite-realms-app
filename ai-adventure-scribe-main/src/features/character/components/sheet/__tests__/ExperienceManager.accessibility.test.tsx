import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';

import ExperienceManager from '../ExperienceManager';

import type { Character } from '@/types/character';

// Mock getExperienceForLevel and getLevelFromExperience from data/levelProgression
vi.mock('@/data/levelProgression', () => ({
  getLevelFromExperience: vi.fn((xp) => {
    if (xp >= 900) return 3;
    if (xp >= 300) return 2;
    return 1;
  }),
  getExperienceForLevel: vi.fn((lvl) => {
    if (lvl === 3) return 900;
    if (lvl === 2) return 300;
    return 0;
  }),
  experienceTable: { 1: 0, 2: 300, 3: 900 }
}));

describe('ExperienceManager Accessibility', () => {
  const mockCharacter = {
    id: 'char-123',
    name: 'Test Character',
    experience: 500,
    level: 2,
  } as Character;

  const mockOnUpdate = vi.fn();

  it('should have a progress bar with dynamic aria-label showing percentage and next level', () => {
    render(<ExperienceManager character={mockCharacter} onUpdate={mockOnUpdate} />);

    // Level 2: 300 XP min. Level 3: 900 XP min.
    // 500 XP is (500-300)/(900-300) = 200/600 = 33.33%

    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-label', expect.stringMatching(/33% toward level 3/));
  });

  it('should have role="status" and aria-live="polite" for level-up notification', () => {
    // 1000 XP is Level 3 (min 900). If character is Level 2, level up is available.
    const levelingCharacter = {
      ...mockCharacter,
      experience: 1000,
      level: 2,
    } as Character;

    render(<ExperienceManager character={levelingCharacter} onUpdate={mockOnUpdate} />);

    const notification = screen.getByText(/Level Up Available!/i).closest('[role="status"]');
    expect(notification).toBeInTheDocument();
    expect(notification).toHaveAttribute('aria-live', 'polite');
  });

  it('should link history toggle button to history content via aria-controls and aria-expanded', () => {
    render(<ExperienceManager character={mockCharacter} onUpdate={mockOnUpdate} />);

    const toggleButton = screen.getByRole('button', { name: /Show History/i });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

    const historyId = toggleButton.getAttribute('aria-controls');
    expect(historyId).toBeTruthy();

    // Content should not be in the document initially
    if (historyId) {
      expect(document.getElementById(historyId)).toBeNull();
    }

    // Click to show
    fireEvent.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');

    if (historyId) {
      const historyContent = document.getElementById(historyId);
      expect(historyContent).toBeInTheDocument();
      expect(historyContent).toHaveAttribute('role', 'region');
      // It should be labeled by the CardTitle (Experience History)
      const title = screen.getByText(/Experience History/i);
      expect(historyContent).toHaveAttribute('aria-labelledby', title.id);
    }
  });

  it('should have title tooltips for level shortcut buttons', () => {
    render(<ExperienceManager character={mockCharacter} onUpdate={mockOnUpdate} />);

    // Level buttons 1-20
    const level10Button = screen.getByRole('button', { name: /Set experience to level 10/i });
    expect(level10Button).toHaveAttribute('title', 'Set experience to level 10');
  });

  it('awards experience correctly', () => {
    render(<ExperienceManager character={mockCharacter} onUpdate={mockOnUpdate} />);

    const amountInput = screen.getByLabelText(/Experience Amount/i);
    const sourceInput = screen.getByLabelText(/Source\/Reason/i);
    const awardButton = screen.getByRole('button', { name: /Award XP/i });

    fireEvent.change(amountInput, { target: { value: '100' } });
    fireEvent.change(sourceInput, { target: { value: 'Test source' } });
    fireEvent.click(awardButton);

    expect(mockOnUpdate).toHaveBeenCalledWith(expect.objectContaining({
      experience: 600
    }));
  });

  it('removes experience correctly', () => {
    render(<ExperienceManager character={mockCharacter} onUpdate={mockOnUpdate} />);

    const amountInput = screen.getByLabelText(/Experience Amount/i);
    const sourceInput = screen.getByLabelText(/Source\/Reason/i);
    const removeButton = screen.getByRole('button', { name: /Remove XP/i });

    fireEvent.change(amountInput, { target: { value: '100' } });
    fireEvent.change(sourceInput, { target: { value: 'Test source' } });
    fireEvent.click(removeButton);

    expect(mockOnUpdate).toHaveBeenCalledWith(expect.objectContaining({
      experience: 400
    }));
  });

  it('sets level correctly', () => {
    render(<ExperienceManager character={mockCharacter} onUpdate={mockOnUpdate} />);

    const level3Button = screen.getByRole('button', { name: /Set experience to level 3/i });
    fireEvent.click(level3Button);

    expect(mockOnUpdate).toHaveBeenCalledWith(expect.objectContaining({
      experience: 900
    }));
  });
});
