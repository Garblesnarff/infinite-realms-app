import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DynamicOptionsSection } from '../DynamicOptionsSection';

// #90: no CombatContext mock — the component no longer reads combat state (its combat cases
// moved to combat-legal-actions.menu.test.tsx).
// Mock the dependent component
vi.mock('@/components/game/ActionOptions', () => ({
  ActionOptions: ({ options }: { options: any[] }) => (
    <div data-testid="action-options">
      {options.map((opt, i) => (
        <button key={i}>{opt.text}</button>
      ))}
    </div>
  ),
}));

describe('DynamicOptionsSection no-action-options notice (GP-015, #219)', () => {
  const mockOnOptionSelect = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders an explicit notice for the latest narration turn with no choices', () => {
    render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
        isLatest
        showNoOptionsNotice
      />,
    );

    expect(screen.getByTestId('no-action-options-notice')).toBeInTheDocument();
  });

  it('stays silent for a past message even when the turn had no choices', () => {
    const { container } = render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
        isLatest={false}
        showNoOptionsNotice
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the turn had no choices and no notice was requested', () => {
    const { container } = render(
      <DynamicOptionsSection
        options={[]}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it('renders the choices, not the notice, when choices exist', () => {
    render(
      <DynamicOptionsSection
        options={[{ id: '1', text: 'Sneak past the guards', number: 1 }] as any}
        onOptionSelect={mockOnOptionSelect}
        hasDynamicOverlay={false}
        isLatest
        showNoOptionsNotice
      />,
    );

    expect(screen.getByTestId('action-options')).toBeInTheDocument();
    expect(screen.getByText('Sneak past the guards')).toBeInTheDocument();
    expect(screen.queryByTestId('no-action-options-notice')).not.toBeInTheDocument();
  });
});
