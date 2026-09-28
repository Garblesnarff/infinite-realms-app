import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { RightSheet } from '../RightSheet';
import { buildSpellCastContext, buildSpellCastMessage } from '../spell-view-model';

import type { CharacterSheetVM } from '../types';

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
    expect(cast).toBeDisabled();
    expect(cast).toHaveTextContent('Casting…');
    // Run M7's second click became a turn the player never took.
    fireEvent.click(cast);
    expect(onCastSpell).not.toHaveBeenCalled();
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
