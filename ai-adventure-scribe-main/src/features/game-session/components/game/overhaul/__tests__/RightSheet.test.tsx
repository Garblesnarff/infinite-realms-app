import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { RightSheet } from '../RightSheet';
import { buildSpellCastContext, buildSpellCastMessage } from '../spell-view-model';

import type { CharacterSheetVM } from '../types';

import { getCharacterResources } from '@/utils/classFeatures';

vi.mock('@/contexts/CampaignContext', () => ({
  useCampaign: () => ({ state: { campaign: null } }),
}));

const sheet: CharacterSheetVM = {
  name: 'Aldric Vale',
  subtitle: 'Human · Fighter (Champion)',
  level: 5,
  xpCurrent: 6500,
  xpMax: 14000,
  hpCurrent: 40,
  hpMax: 44,
  ac: 18,
  initiative: '+2',
  speed: 30,
  abilityScores: [],
  savingThrows: [],
  skills: [],
  attacks: [
    { id: 'a1', name: 'Longsword', bonus: '+6', damage: '1d8+3' },
    { id: 'a2', name: 'Shield Bash', bonus: '+5', damage: '1d4+3' },
  ],
  conditions: [],
  equipment: [],
  inventory: [],
  spells: { cantrips: [], known: [], prepared: [] },
  spellcasting: null,
};

const casterSheet: CharacterSheetVM = {
  ...sheet,
  name: 'The Scholar',
  subtitle: 'Human · Wizard',
  spells: {
    cantrips: [
      {
        id: 'fire-bolt',
        name: 'Fire Bolt',
        level: 0,
        isPrepared: true,
        canPrepare: false,
      },
    ],
    known: [
      {
        id: 'magic-missile',
        name: 'Magic Missile',
        level: 1,
        isPrepared: true,
        canPrepare: true,
      },
    ],
    prepared: [
      {
        id: 'magic-missile',
        name: 'Magic Missile',
        level: 1,
        isPrepared: true,
        canPrepare: true,
      },
    ],
  },
  spellcasting: {
    ability: 'INT',
    spellAttackBonus: 5,
    spellSaveDC: 13,
    canPrepare: true,
    slots: [{ level: 1, current: 4, max: 4 }],
  },
};

describe('RightSheet attacks list', () => {
  it('renders an em dash when AC is missing from stored character stats', () => {
    render(<RightSheet c={{ ...sheet, ac: null }} />);

    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('lists attacks without a dead View All Attacks control', () => {
    render(<RightSheet c={sheet} />);

    expect(screen.getByText('Longsword')).toBeInTheDocument();
    expect(screen.getByText('Shield Bash')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View All Attacks/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/View All Attacks/i)).not.toBeInTheDocument();
  });

  it('shows spell groups and routes out-of-combat casts to the handler', async () => {
    const onCastSpell = vi.fn().mockResolvedValue(undefined);
    const onTogglePrepared = vi.fn().mockResolvedValue(undefined);
    render(
      <RightSheet c={casterSheet} onCastSpell={onCastSpell} onTogglePrepared={onTogglePrepared} />,
    );

    expect(screen.getByText('Spells')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Cantrips' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Spellbook' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Prepared' })).toBeInTheDocument();
    expect(screen.getByText('4/4')).toBeInTheDocument();
    expect(screen.getByText('Save DC')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Unprepare Magic Missile' }));
    expect(onTogglePrepared).toHaveBeenCalledWith('magic-missile', false);

    fireEvent.click(screen.getByRole('button', { name: 'Cast Magic Missile' }));
    expect(onCastSpell).toHaveBeenCalledWith(casterSheet.spells.known[0]);

    expect(buildSpellCastContext(casterSheet.spells.known[0])).toEqual({
      intent: 'spell_cast',
      spellId: 'magic-missile',
      spellLevel: 1,
    });
    expect(buildSpellCastMessage(casterSheet.spells.known[0])).toBe(
      'I cast Magic Missile [spell_id=magic-missile, spell_level=level 1].',
    );
  });

  it('keeps Cast available in combat and routes it to the same turn handler (#2233)', () => {
    const onCastSpell = vi.fn().mockResolvedValue(undefined);
    render(<RightSheet c={casterSheet} isInCombat onCastSpell={onCastSpell} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cast Magic Missile' }));
    expect(onCastSpell).toHaveBeenCalledWith(casterSheet.spells.known[0]);
  });

  it('holds every Cast button while a cast is in flight (#2305)', () => {
    const onCastSpell = vi.fn();
    const castingSpellId = casterSheet.spells.known[0].id;
    render(
      <RightSheet
        c={casterSheet}
        isInCombat
        castingSpellId={castingSpellId}
        onCastSpell={onCastSpell}
      />,
    );

    const cast = screen.getByRole('button', { name: 'Cast Magic Missile' });
    // aria-disabled, not disabled (#2418): the button keeps its place in the tab order.
    expect(cast).toHaveAttribute('aria-disabled', 'true');
    expect(cast).not.toBeDisabled();
    expect(cast).toHaveTextContent('Casting…');
    // Run M7's second click became a turn the player never took.
    fireEvent.click(cast);
    expect(onCastSpell).not.toHaveBeenCalled();
  });

  it('marks the other Cast buttons aria-disabled while one cast runs, and none before (#2418)', () => {
    const onCastSpell = vi.fn();
    const { rerender } = render(<RightSheet c={casterSheet} onCastSpell={onCastSpell} />);

    const fireBolt = screen.getByRole('button', { name: 'Cast Fire Bolt' });
    expect(fireBolt).not.toHaveAttribute('aria-disabled');
    fireEvent.click(fireBolt);
    expect(onCastSpell).toHaveBeenCalledTimes(1);

    rerender(
      <RightSheet c={casterSheet} castingSpellId="magic-missile" onCastSpell={onCastSpell} />,
    );
    const waiting = screen.getByRole('button', { name: 'Cast Fire Bolt' });
    expect(waiting).toHaveAttribute('aria-disabled', 'true');
    expect(waiting).toHaveTextContent('Cast');
    fireEvent.click(waiting);
    expect(onCastSpell).toHaveBeenCalledTimes(1);
  });

  it('gives every Cast button at least 44 px of height and readable text (#2418)', () => {
    render(<RightSheet c={casterSheet} onCastSpell={vi.fn()} />);

    for (const name of ['Cast Fire Bolt', 'Cast Magic Missile']) {
      const button = screen.getByRole('button', { name });
      expect(button).toHaveClass('min-h-11');
      expect(button.className).not.toMatch(/text-\[10px\]|\bh-6\b/);
    }
  });

  it('shows no Spells panel for a character with no spellcasting and no spells (#2483)', () => {
    render(<RightSheet c={sheet} />);

    expect(screen.queryByText('Spells')).not.toBeInTheDocument();
    expect(screen.queryByText('Spell Slots')).not.toBeInTheDocument();
    expect(screen.queryByText('No spellcasting data recorded.')).not.toBeInTheDocument();
  });

  it('does not offer a cast action during combat or a preparation toggle to non-casters', () => {
    render(<RightSheet c={casterSheet} isInCombat />);
    expect(screen.queryByRole('button', { name: 'Cast Magic Missile' })).not.toBeInTheDocument();

    const nonCaster = {
      ...sheet,
      spells: {
        cantrips: [],
        known: [
          {
            id: 'stored-spell',
            name: 'Stored Spell',
            level: 1,
            isPrepared: false,
            canPrepare: false,
          },
        ],
        prepared: [],
      },
    } satisfies CharacterSheetVM;
    render(<RightSheet c={nonCaster} />);
    expect(screen.queryByRole('button', { name: /Prepare Stored Spell/i })).not.toBeInTheDocument();
  });
});

describe('RightSheet class resources (#1061)', () => {
  it('renders class resource pools in the in-session sheet', () => {
    render(
      <RightSheet
        c={{
          ...sheet,
          subtitle: 'Human · Sorcerer',
          resources: getCharacterResources('sorcerer', 2),
        }}
      />,
    );

    expect(screen.getByText('Character Resources')).toBeInTheDocument();
    expect(screen.getByText('Sorcery Points')).toBeInTheDocument();
    expect(screen.getAllByText('2 / 2').length).toBeGreaterThan(0);
  });
});

describe('RightSheet concentration indicator (#709)', () => {
  it('shows the Concentrating panel with the server-side spell', () => {
    render(<RightSheet c={{ ...sheet, concentratingOn: 'Dancing Lights' }} />);

    expect(screen.getByText('Concentrating')).toBeInTheDocument();
    expect(screen.getByText('Dancing Lights')).toBeInTheDocument();
  });

  it('hides the Concentrating panel when nothing is concentrated', () => {
    render(<RightSheet c={{ ...sheet, concentratingOn: null }} />);

    expect(screen.queryByText('Concentrating')).not.toBeInTheDocument();
  });
});

describe('RightSheet inventory equip control (#1059)', () => {
  const gearSheet: CharacterSheetVM = {
    ...sheet,
    inventory: [
      { id: 'Shortbow', name: 'Shortbow', quantity: 1, equippable: true },
      { id: 'Arrows (20)', name: 'Arrows (20)', quantity: 1 },
      { id: 'Leather Armor', name: 'Leather Armor', quantity: 1, equippable: true },
    ],
  };

  it('offers Equip on equippable rows only and routes the click to the handler', () => {
    const onEquipItem = vi.fn().mockResolvedValue(undefined);
    render(<RightSheet c={gearSheet} onEquipItem={onEquipItem} />);

    fireEvent.click(screen.getByRole('button', { name: 'Equip Shortbow' }));
    expect(onEquipItem).toHaveBeenCalledWith(gearSheet.inventory[0]);
    expect(screen.getByRole('button', { name: 'Equip Leather Armor' })).toBeInTheDocument();
    // Ammunition and the rest of the pack stay inert text.
    expect(screen.queryByRole('button', { name: 'Equip Arrows (20)' })).not.toBeInTheDocument();
  });

  it('renders no Equip control without a handler', () => {
    render(<RightSheet c={gearSheet} />);

    expect(screen.queryByRole('button', { name: /^Equip / })).not.toBeInTheDocument();
  });

  it('disables the row being equipped and shows the equip error', () => {
    render(
      <RightSheet
        c={gearSheet}
        onEquipItem={vi.fn()}
        equippingItemId="Shortbow"
        equipActionError="Unable to equip Shortbow."
      />,
    );

    const button = screen.getByRole('button', { name: 'Equip Shortbow' });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent('Equipping…');
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to equip Shortbow.');
  });
});
