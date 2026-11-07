/**
 * #1402: a hero with no equipment rows picks a starting package on the sheet.
 *
 * Renders the real StartingEquipmentChooser (the wizard's EquipmentSelection in a nested
 * provider), clicks the real Monk package card, then runs the sheet's own save producer
 * (buildSheetUpdatePayload -> prepareCharacterPayload). The wire body must equal the pinned
 * fixture that the server test replays through PUT /v1/characters/:id.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import wireBody from '../../../../../../../../shared/test-fixtures/sheet-starting-package-put.json';
import { StartingEquipmentChooser } from '../StartingEquipmentChooser';

import type { Character } from '@/types/character';

import { backgrounds } from '@/data/backgroundOptions';
import { monk } from '@/data/classes/monk';
import { buildSheetUpdatePayload } from '@/hooks/use-character-data';
import { prepareCharacterPayload } from '@/services/user-data-payload-helpers';

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/hooks/use-auto-scroll', () => ({
  useAutoScroll: () => ({ scrollToNavigation: vi.fn(), scrollToTop: vi.fn() }),
}));

const sheetHero: Character = {
  id: 'hero-1402',
  name: 'Hero 1402',
  class: monk,
  background: backgrounds.find((b) => b.id === 'outlander') ?? null,
  level: 1,
  inventory: [],
  currency: { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 },
} as unknown as Character;

describe('sheet starting-equipment chooser (#1402)', () => {
  it('saves the package the wizard list builds, as the pinned PUT body', () => {
    const onSave = vi.fn();
    const onDone = vi.fn();
    render(<StartingEquipmentChooser character={sheetHero} onSave={onSave} onDone={onDone} />);

    expect(screen.getByRole('button', { name: 'Save starting equipment' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Monk Equipment Package/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save starting equipment' }));

    expect(onSave).toHaveBeenCalledTimes(1);
    const updated = onSave.mock.calls[0][0] as Character;
    const put = prepareCharacterPayload(buildSheetUpdatePayload(sheetHero, updated));
    expect(put).toEqual(wireBody);
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
