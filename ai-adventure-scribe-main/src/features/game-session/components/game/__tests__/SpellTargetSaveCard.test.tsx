import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RollTraySlotProvider } from '../game-content/roll-tray-slot';
import { SpellTargetSaveCard } from '../SpellTargetSaveCard';

import type { PendingSpellTargetSave } from '@/hooks/combat/use-spell-target-save-host';

const STORAGE_KEY = 'ui:showTargetNumbers:v1';

const pendingFor = (
  spec: Partial<PendingSpellTargetSave['spec']> = {},
): PendingSpellTargetSave & {
  continue: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} => ({
  spec: {
    actorLabel: 'Rook',
    targetLabel: 'Professor Umeboshi',
    spellName: 'Acid Splash',
    saveAbility: 'DEX',
    ...spec,
  },
  continue: vi.fn(),
  cancel: vi.fn(),
});

afterEach(() => window.localStorage.clear());

describe('SpellTargetSaveCard', () => {
  it('shows "<Name> must save", the save in words, and no player roll; Continue carries on', () => {
    const pending = pendingFor({ saveDc: 14 });

    render(<SpellTargetSaveCard pending={pending} />);

    expect(screen.getByTestId('spell-target-save-card')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Professor Umeboshi must save' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Professor Umeboshi makes a Dexterity saving throw against Acid Splash.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Save DC 14. You do not roll.')).toBeInTheDocument();
    expect(screen.queryByText(/1d20/i)).not.toBeInTheDocument();
    // The player already pressed Cast; the card's button carries on, it does not cast again (#2392).
    expect(screen.queryByRole('button', { name: /^cast/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(pending.continue).toHaveBeenCalledTimes(1);
    expect(pending.cancel).not.toHaveBeenCalled();
  });

  it('leaves the DC out when "Show target numbers" is off, and when the engine gave none', () => {
    window.localStorage.setItem(STORAGE_KEY, 'off');
    const { rerender } = render(<SpellTargetSaveCard pending={pendingFor({ saveDc: 14 })} />);
    expect(screen.getByText('You do not roll.')).toBeInTheDocument();
    expect(screen.queryByText(/Save DC/)).not.toBeInTheDocument();

    act(() => window.localStorage.setItem(STORAGE_KEY, 'on'));
    rerender(<SpellTargetSaveCard pending={pendingFor()} />);
    expect(screen.getByText('You do not roll.')).toBeInTheDocument();
  });

  it('has Cancel cast, which gives the cast up without continuing', () => {
    const pending = pendingFor();
    render(<SpellTargetSaveCard pending={pending} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel cast' }));

    expect(pending.cancel).toHaveBeenCalledTimes(1);
    expect(pending.continue).not.toHaveBeenCalled();
  });

  it('moves focus to Continue, and Escape cancels', () => {
    const pending = pendingFor();
    render(<SpellTargetSaveCard pending={pending} />);

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toHaveFocus();
    fireEvent.keyDown(continueButton, { key: 'Escape' });

    expect(pending.cancel).toHaveBeenCalledTimes(1);
    expect(pending.continue).not.toHaveBeenCalled();
  });

  it('gives focus back to the control that had it once the card is gone', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { rerender } = render(<SpellTargetSaveCard pending={pendingFor()} />);
    expect(screen.getByRole('button', { name: 'Continue' })).toHaveFocus();

    rerender(<SpellTargetSaveCard pending={null} />);

    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('sits in the roll tray slot, in flow, and not over the page', () => {
    const slot = document.createElement('div');
    document.body.appendChild(slot);

    render(
      <RollTraySlotProvider value={slot}>
        <SpellTargetSaveCard pending={pendingFor()} />
      </RollTraySlotProvider>,
    );

    const card = screen.getByTestId('spell-target-save-card');
    expect(slot).toContainElement(card);
    expect(card.closest('[data-testid="roll-tray"]')).not.toBeNull();
    expect(card.className).not.toMatch(/fixed|absolute|sticky/);
    slot.remove();
  });

  it('gives Continue 52 px and Cancel cast 44 px, full width at 390 px', () => {
    render(<SpellTargetSaveCard pending={pendingFor()} />);

    const continueButton = screen.getByRole('button', { name: 'Continue' });
    const cancelButton = screen.getByRole('button', { name: 'Cancel cast' });
    expect(continueButton).toHaveClass('h-[52px]', 'w-full');
    expect(cancelButton).toHaveClass('h-11', 'w-full');
  });

  it('renders nothing without a pending save', () => {
    render(<SpellTargetSaveCard pending={null} />);

    expect(screen.queryByTestId('spell-target-save-card')).not.toBeInTheDocument();
  });

  it('resolves a raw slug target through the shared display-name module (#2343 B4)', () => {
    render(
      <SpellTargetSaveCard
        pending={pendingFor({ targetLabel: 'shimmering-spore-shape-1' })}
        roster={[{ id: 'shimmering-spore-shape-1', name: 'shimmering-spore-shape-1' }]}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Shimmering Spore Shape 1 must save' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/shimmering-spore-shape-1/)).not.toBeInTheDocument();
  });

  it('prefers the roster name over the raw label (#2343 B4)', () => {
    render(
      <SpellTargetSaveCard
        pending={pendingFor({ targetLabel: 'shimmering-spore-shape-1' })}
        roster={[{ id: 'shimmering-spore-shape-1', name: 'Shimmering Spore-Shape' }]}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Shimmering Spore-Shape must save' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Shimmering Spore-Shape makes a Dexterity saving throw against Acid Splash.',
      ),
    ).toBeInTheDocument();
  });

  it('resolves a slug label to the roster name when the roster id is a uuid (#2343 B4, run 16)', () => {
    render(
      <SpellTargetSaveCard
        pending={pendingFor({ targetLabel: 'captain-sarah-reeves', spellName: 'Fireball' })}
        roster={[{ id: 'a3f1c2d4-1234-4abc-8def-0123456789ab', name: 'Captain Sarah Reeves' }]}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Captain Sarah Reeves must save' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Captain Sarah Reeves makes a Dexterity saving throw against Fireball.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/captain-sarah-reeves/)).not.toBeInTheDocument();
  });
});
