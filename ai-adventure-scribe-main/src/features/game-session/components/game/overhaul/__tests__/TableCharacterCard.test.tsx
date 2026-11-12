import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TableCharacterCard } from '../LeftRail';
import { buildCharacterSheet } from '../useOverhaulViewModel';

describe('Table character card', () => {
  it('uses the sheet values and opens the full sheet', () => {
    const open = vi.fn();
    const character = {
      ...buildCharacterSheet(null),
      name: 'The Scholar',
      hpCurrent: 4,
      hpMax: 7,
      ac: 11,
      resources: {
        hitDice: {},
        secondWind: { current: 1, max: 1 },
        kiPoints: { current: 2, max: 3 },
      },
      attacks: [{ id: 'staff', name: 'Quarterstaff', bonus: '+2', damage: '1d6' }],
    };
    render(<TableCharacterCard character={character} onOpenSheet={open} />);
    expect(screen.getByRole('heading', { name: 'The Scholar', hidden: true })).toBeInTheDocument();
    expect(screen.getByText(/Hit points · 4 \/ 7/)).toBeInTheDocument();
    expect(screen.getByText('Quarterstaff +2 · 1d6')).toBeInTheDocument();
    expect(screen.queryByText(/Second Wind/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Ki Points/)).not.toBeInTheDocument();
    expect(screen.getByText('♥ ♥ ♥ ♥ ♡ ♡ ♡')).toHaveAttribute('aria-hidden', 'true');
    const summary = screen.getByRole('button', { name: /The Scholar.*AC 11/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Open full sheet' }));
    expect(open).toHaveBeenCalledOnce();
  });

  it('uses the resized alternate portrait when the primary is unsupported or fails', () => {
    const base = new URL('/storage/v1/object/public/portraits/', window.location.href).href;
    const character = {
      ...buildCharacterSheet(null),
      name: 'Hero',
      avatarUrl: `${base}avatar.png`,
    };
    const view = render(
      <TableCharacterCard
        character={character}
        preferredPortrait={new URL('/unbounded.png', window.location.href).href}
        onOpenSheet={() => {}}
      />,
    );
    const images = () =>
      screen.getAllByRole('presentation', { hidden: true }) as HTMLImageElement[];
    expect(images()[0].src).toContain('/storage/v1/render/image/public/portraits/avatar.png');
    view.rerender(
      <TableCharacterCard
        character={character}
        preferredPortrait={`${base}primary.png`}
        onOpenSheet={() => {}}
      />,
    );
    expect(images()[0].src).toContain('/storage/v1/render/image/public/portraits/primary.png');
    fireEvent.error(images()[0]);
    expect(images()[0].src).toContain('/storage/v1/render/image/public/portraits/avatar.png');
  });

  it('pins the portrait with a decorative paper clip and sets the plaques', () => {
    const { container } = render(
      <TableCharacterCard
        character={{ ...buildCharacterSheet(null), attacks: [] }}
        onOpenSheet={vi.fn()}
      />,
    );
    const clip = container.querySelector('svg.ir-paper-clip');
    expect(clip).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('dl.ir-plaques')).toBeInTheDocument();
  });
});
