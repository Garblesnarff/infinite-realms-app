import { describe, expect, it } from 'vitest';

import { declaredSheetSpell, isSameSpell, spellIdentity } from '../declared-player-spell';

import { buildSpellCastMessage } from '@/features/game-session/components/game/overhaul/spell-view-model';

describe('the spell a sheet-Cast message declares (#2304)', () => {
  it('reads the tag the Cast button writes', () => {
    expect(
      declaredSheetSpell(
        buildSpellCastMessage({ name: 'Burning Hands', id: 'burning-hands', level: 1 }),
      ),
    ).toEqual({ spellId: 'burning-hands', spellName: 'Burning Hands' });
  });

  it('ignores free text with no tag', () => {
    expect(declaredSheetSpell('I cast Burning Hands at him')).toBeNull();
  });

  it.each(['chill_touch', 'Chill Touch', 'chill-touch', ' CHILL TOUCH '])(
    'treats %s as Chill Touch',
    (spelling) => {
      expect(spellIdentity(spelling)).toBe('chill-touch');
      expect(isSameSpell(spelling, 'chill-touch')).toBe(true);
    },
  );

  it('tells Burning Hands and Chill Touch apart, and never matches an empty id', () => {
    expect(isSameSpell('burning-hands', 'chill-touch')).toBe(false);
    expect(isSameSpell('', '')).toBe(false);
    expect(isSameSpell(null, 'burning-hands')).toBe(false);
  });

  it('matches spells outside the combat scope by the same slug rule', () => {
    expect(isSameSpell('Charm_Person', 'charm-person')).toBe(true);
  });
});
