import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { Spell } from '@/types/character';

import { PreparationTab } from '@/components/character-creation/steps/advanced-spellcasting/PreparationTab';
import { Tabs } from '@/components/ui/tabs';

const spell = (id: string, name: string): Spell =>
  ({
    id,
    name,
    level: 1,
    school: 'Evocation',
    casting_time: '1 action',
    range_text: 'Self',
    description: 'desc',
  }) as unknown as Spell;

function renderTab(handleSpellPreparation = vi.fn()): ReturnType<typeof render> {
  return render(
    <Tabs value="preparation">
      <PreparationTab
        preparedSpells={['bless']}
        maxPreparedSpells={2}
        availableSpells={[spell('bless', 'Bless'), spell('bane', 'Bane')]}
        alwaysPreparedSpells={['Bless']}
        handleSpellPreparation={handleSpellPreparation}
      />
    </Tabs>,
  );
}

describe('#899 remainder: domain spells are labelled always prepared', () => {
  it('labels the subclass-granted spell and leaves an ordinary spell unlabelled', () => {
    renderTab();
    const blessCard = screen.getByText('Bless').closest('div.p-3') as HTMLElement;
    const baneCard = screen.getByText('Bane').closest('div.p-3') as HTMLElement;
    expect(within(blessCard).getByText('Always prepared')).toBeTruthy();
    expect(within(baneCard).queryByText('Always prepared')).toBeNull();
  });

  it('does not let the always-prepared spell be toggled off', () => {
    const handle = vi.fn();
    renderTab(handle);
    const blessCard = screen.getByText('Bless').closest('div.p-3') as HTMLElement;
    fireEvent.click(blessCard);
    expect(handle).not.toHaveBeenCalledWith('bless', false);
  });
});
