import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import fixture from '../../../shared/test-fixtures/tiefling-thaumaturgy.json';
import { convertSpellIdsToDatabase, convertSpellIdsToFrontend } from '../spell-id-mapping';

import SpellCard from '@/components/spells/SpellCard';
import { getSpellById } from '@/data/spells/api';

describe('#933 Thaumaturgy save and reload mapping', () => {
  it('serializes the exact route spell body and renders the reloaded cantrip', () => {
    expect({
      spells: convertSpellIdsToDatabase(['thaumaturgy']),
      className: 'Wizard',
      prepared: [],
    }).toEqual(fixture.spells);
    const [id] = convertSpellIdsToFrontend(fixture.spells.spells);
    const spell = getSpellById(id)!;
    expect(spell.level).toBe(0);
    render(<SpellCard spell={spell} isSelected={true} isDisabled={false} onToggle={vi.fn()} />);
    expect(screen.getByText('Thaumaturgy')).toBeInTheDocument();
    expect(screen.getByText('Cantrip')).toBeInTheDocument();
  });
});
