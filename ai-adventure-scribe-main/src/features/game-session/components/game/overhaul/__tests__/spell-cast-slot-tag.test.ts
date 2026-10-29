import { describe, expect, it } from 'vitest';

import { buildSpellCastMessage } from '../spell-view-model';

import { declaredSheetSpell } from '@/services/combat/declared-player-spell';

/**
 * #1227: the sheet's Cast tag names the slot the cast spends, by the same rule as the ActionBar
 * and the combat-entry first action. dm-actions-handler carries the tag's level into the engine
 * action (#1058), so with the 1st-level slots spent the cast goes out with a 2nd-level slot.
 */
describe('the sheet Cast tag names the slot it spends (#1227)', () => {
  const burningHands = { name: 'Burning Hands', id: 'burning-hands', level: 1 };

  it('names the lowest remaining slot at or above the spell level', () => {
    const message = buildSpellCastMessage(burningHands, [
      { level: 1, current: 0 },
      { level: 2, current: 2 },
    ]);
    expect(message).toBe('I cast Burning Hands [spell_id=burning-hands, spell_level=level 2].');
    expect(declaredSheetSpell(message)).toMatchObject({
      spellId: 'burning-hands',
      slotLevel: 2,
    });
  });

  it("names the spell's own level while a slot of it remains, or with no slots known", () => {
    expect(
      buildSpellCastMessage(burningHands, [
        { level: 1, current: 1 },
        { level: 2, current: 2 },
      ]),
    ).toBe('I cast Burning Hands [spell_id=burning-hands, spell_level=level 1].');
    expect(buildSpellCastMessage(burningHands)).toBe(
      'I cast Burning Hands [spell_id=burning-hands, spell_level=level 1].',
    );
  });

  it('keeps a cantrip a cantrip', () => {
    expect(
      buildSpellCastMessage({ name: 'Fire Bolt', id: 'fire-bolt', level: 0 }, [
        { level: 1, current: 0 },
      ]),
    ).toBe('I cast Fire Bolt [spell_id=fire-bolt, spell_level=cantrip].');
  });
});
