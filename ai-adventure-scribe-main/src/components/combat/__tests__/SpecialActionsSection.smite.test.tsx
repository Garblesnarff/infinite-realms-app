import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { SpecialActionsSection } from '../SpecialActionsSection';

import type { CombatEncounter as Encounter } from '@/types/combat';
import type { SpellSlotLevel } from '@/types/combat-features';

type Participant = Encounter['participants'][number];

const slotsWith = (levels: Partial<Record<SpellSlotLevel, number>>) => {
  const all = {} as Record<SpellSlotLevel, { max: number; current: number }>;
  for (let level = 1; level <= 9; level++) {
    const current = levels[level as SpellSlotLevel] ?? 0;
    all[level as SpellSlotLevel] = { max: current, current };
  }
  return all;
};

const paladin = (spellSlots: ReturnType<typeof slotsWith>) =>
  ({
    id: 'paladin-1',
    name: 'Paladin',
    participantType: 'player',
    characterClass: 'paladin',
    spellSlots,
  }) as unknown as Participant;

const renderSection = (participant: Participant, onEnhancedAttack = vi.fn()) => {
  render(
    <SpecialActionsSection
      currentParticipant={participant}
      selectedEnemyId="orc-1"
      onCombatAction={vi.fn()}
      onRollInitiative={vi.fn()}
      onTwoWeaponAttack={vi.fn()}
      onEnhancedAttack={onEnhancedAttack}
    />,
  );
  return onEnhancedAttack;
};

describe('SpecialActionsSection Divine Smite picker (#1362)', () => {
  it('offers only the slot levels the Paladin has left', () => {
    renderSection(paladin(slotsWith({ 1: 2, 2: 0, 3: 1 })));

    expect(screen.getByRole('button', { name: 'Divine Smite (1st)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Divine Smite (3rd)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Divine Smite (2nd)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Divine Smite (4th)' })).toBeNull();
  });

  it('sends the chosen level, not a hard-coded first', () => {
    const onEnhancedAttack = renderSection(paladin(slotsWith({ 1: 1, 2: 2 })));

    fireEvent.click(screen.getByRole('button', { name: 'Divine Smite (2nd)' }));

    expect(onEnhancedAttack).toHaveBeenCalledWith(
      'paladin-1',
      'orc-1',
      'divine_smite',
      false,
      false,
      2,
    );
  });

  it('offers no Smite when the Paladin has no slot left', () => {
    renderSection(paladin(slotsWith({})));

    expect(screen.queryByRole('button', { name: /Divine Smite/ })).toBeNull();
  });

  it('offers no Smite to a character who is not a Paladin', () => {
    const fighter = { ...paladin(slotsWith({ 1: 2 })), characterClass: 'fighter' } as Participant;
    renderSection(fighter);

    expect(screen.queryByRole('button', { name: /Divine Smite/ })).toBeNull();
  });
});
