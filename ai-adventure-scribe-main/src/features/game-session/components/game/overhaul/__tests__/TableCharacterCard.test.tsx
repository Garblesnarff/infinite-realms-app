import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { TableCharacterCard } from '../LeftRail';
import { buildCharacterSheet } from '../useOverhaulViewModel';

import type { Character } from '@/types/character';

const scores = {
  strength: { score: 10, modifier: 0, savingThrow: false },
  dexterity: { score: 14, modifier: 2, savingThrow: false },
  constitution: { score: 14, modifier: 2, savingThrow: false },
  intelligence: { score: 10, modifier: 0, savingThrow: false },
  wisdom: { score: 12, modifier: 1, savingThrow: false },
  charisma: { score: 16, modifier: 3, savingThrow: false },
};

/** Session loader shape: class is a name stub, class_features is the GET overlay. */
function sessionCharacter(partial: Partial<Character>): Character {
  return {
    id: 'session-hero',
    name: 'Clarice',
    level: 3,
    race: { name: 'Human', speed: 30, traits: [], languages: [] },
    abilityScores: scores,
    character_stats: { current_hit_points: 18, max_hit_points: 18 },
    ...partial,
  } as unknown as Character;
}

describe('Table character card', () => {
  it('uses the sheet values and links Open full sheet to the standalone sheet (#1705)', () => {
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
    render(<TableCharacterCard character={character} characterId="char-42" onOpenSheet={open} />);
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
    const sheetLink = screen.getByRole('link', { name: 'Open full sheet' });
    expect(sheetLink).toHaveAttribute('href', '/app/character/char-42');
    sheetLink.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(sheetLink);
    expect(open).not.toHaveBeenCalled();
  });

  it('omits Open full sheet when no character id is available', () => {
    render(<TableCharacterCard character={buildCharacterSheet(null)} onOpenSheet={vi.fn()} />);
    expect(screen.queryByRole('link', { name: 'Open full sheet' })).not.toBeInTheDocument();
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

  it('shows the Lay on Hands pool from the tracked overlay the sheet reads (#1670)', () => {
    const sheet = buildCharacterSheet(
      sessionCharacter({
        class: { name: 'Paladin' } as Character['class'],
        classFeatures: { lay_on_hands: { currentUses: 12, maxUses: 15 } },
      }),
    );
    expect(sheet.resources?.layOnHands).toEqual({ current: 12, max: 15 });
    render(<TableCharacterCard character={sheet} onOpenSheet={vi.fn()} />);
    expect(screen.getByText('Lay on Hands · 12 / 15 points')).toBeInTheDocument();
  });

  it('moves the Lay on Hands line when the pool changes, with no reload (#1670)', () => {
    const paladin = { class: { name: 'Paladin' } as Character['class'] };
    const view = render(
      <TableCharacterCard
        character={buildCharacterSheet(
          sessionCharacter({
            ...paladin,
            classFeatures: { lay_on_hands: { currentUses: 12, maxUses: 15 } },
          }),
        )}
        onOpenSheet={vi.fn()}
      />,
    );
    expect(screen.getByText('Lay on Hands · 12 / 15 points')).toBeInTheDocument();
    // New props from the CharacterContext refresh (character-pool-updated →
    // SET_TRACKED_USES → useOverhaulViewModel recompute). This rerender proves
    // the card follows its props with no reload; the event→dispatch half is
    // covered by use-character-refresh.pool.test.tsx, not here.
    view.rerender(
      <TableCharacterCard
        character={buildCharacterSheet(
          sessionCharacter({
            ...paladin,
            classFeatures: { lay_on_hands: { currentUses: 7, maxUses: 15 } },
          }),
        )}
        onOpenSheet={vi.fn()}
      />,
    );
    expect(screen.getByText('Lay on Hands · 7 / 15 points')).toBeInTheDocument();
    expect(screen.queryByText('Lay on Hands · 12 / 15 points')).not.toBeInTheDocument();
  });
});
