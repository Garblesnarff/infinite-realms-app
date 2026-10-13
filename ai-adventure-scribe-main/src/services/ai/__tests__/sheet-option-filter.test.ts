/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #400 — the DM's suggested options are filtered against the character sheet
 * deterministically: a suggestion naming a spell or attack the character cannot use never
 * reaches the screen. The SRD spell/weapon lists are the recognition source, the sheet the
 * keep/drop gate; anything unrecognizable passes through untouched.
 */
import { describe, expect, it } from 'vitest';

import {
  extractOptionTitle,
  extractSheetCombatNames,
  filterOptionsAgainstSheet,
  normalizeCombatName,
  type SheetCombatNames,
} from '../sheet-option-filter';

const SHEET: SheetCombatNames = {
  attacks: ['longsword', 'unarmed strike'],
  spells: ['fire bolt', 'cure wounds'],
};

describe('extractSheetCombatNames', () => {
  it('takes attacks from sheet equipment that names a real weapon, plus unarmed strike', () => {
    const sheet = extractSheetCombatNames({
      equipment: ['Longsword', 'Rope', 'Backpack'],
    });
    expect(sheet.attacks).toEqual(['longsword', 'unarmed strike']);
  });

  it('collects cantrips and known/prepared/pact/ritual spells', () => {
    const sheet = extractSheetCombatNames({
      cantrips: ['Fire Bolt'],
      knownSpells: ['Cure Wounds'],
      preparedSpells: ['Bless'],
      pactMagicSpells: ['Hex'],
      ritualSpells: ['Detect Magic'],
    });
    expect(sheet.spells).toEqual(
      expect.arrayContaining(['fire bolt', 'cure wounds', 'bless', 'hex', 'detect magic']),
    );
  });

  it('returns null when there is no sheet — the caller must not filter then', () => {
    expect(extractSheetCombatNames(null)).toBeNull();
    expect(extractSheetCombatNames(undefined)).toBeNull();
  });

  it('survives non-string entries', () => {
    expect(
      extractSheetCombatNames({ equipment: [42, null], cantrips: 'not-a-list' } as any),
    ).toEqual({ attacks: ['unarmed strike'], spells: [] });
  });
});

describe('extractOptionTitle', () => {
  it('takes the bold action phrase', () => {
    expect(extractOptionTitle('A. **Fire Bolt**, hurl a mote of flame')).toBe('Fire Bolt');
  });

  it('falls back to the text after the marker for unbolded options', () => {
    expect(extractOptionTitle('1. Sneak around, quietly')).toBe('Sneak around');
  });
});

describe('filterOptionsAgainstSheet', () => {
  it('keeps sheet spells and attacks', () => {
    const options = [
      'A. **Fire Bolt**, hurl a mote of flame at the goblin.',
      'B. **Attack with Longsword**, swing at the goblin.',
      'C. **Unarmed Strike**, punch the goblin.',
    ];
    expect(filterOptionsAgainstSheet(options, SHEET)).toEqual(options);
  });

  it('drops SRD spells and weapons the sheet does not have', () => {
    const options = [
      'A. **Fireball**, engulf them in flame.',
      'B. **Attack with Greataxe**, hew through them.',
      'C. **Cast Lightning Bolt**, call down the storm.',
    ];
    expect(filterOptionsAgainstSheet(options, SHEET)).toEqual([]);
  });

  it('keeps options that name nothing recognizable as a spell or attack', () => {
    const options = [
      'A. **Talk**, try to parley with the goblin.',
      'B. **Hide**, duck behind the barrel.',
      'C. **Dart away**, run for the treeline.',
    ];
    expect(filterOptionsAgainstSheet(options, SHEET)).toEqual(options);
  });

  it('is case- and whitespace-insensitive', () => {
    expect(
      filterOptionsAgainstSheet(['A. **  FIRE bolt **, hurl flame.'], SHEET),
    ).toEqual(['A. **  FIRE bolt **, hurl flame.']);
    expect(filterOptionsAgainstSheet(['A. **FireBall**, boom.'], SHEET)).toEqual([]);
  });

  it('normalizes the verb away but still drops an illegal core', () => {
    // "Attack with X" where X is on the sheet stays; where X is a real weapon the
    // character does not carry, the suggestion goes.
    expect(
      filterOptionsAgainstSheet(['A. **Attack with Longsword**, swing.'], SHEET),
    ).toHaveLength(1);
    expect(filterOptionsAgainstSheet(['A. **Attack with Maul**, swing.'], SHEET)).toEqual(
      [],
    );
  });

  it('does not mistake a verb-led spell name for the verb', () => {
    // "Fire Shield" is a real spell; stripping "fire" as a verb would hide it.
    expect(filterOptionsAgainstSheet(['A. **Fire Shield**, ward yourself.'], SHEET)).toEqual(
      [],
    );
  });

  it('keeps a verb-led title whose core is not a spell or attack', () => {
    expect(
      filterOptionsAgainstSheet(['A. **Strike a bargain**, offer gold.'], SHEET),
    ).toHaveLength(1);
  });

  it('keeps order and drops only the illegal entries', () => {
    const options = [
      'A. **Fire Bolt**, hurl flame.',
      'B. **Fireball**, engulf them.',
      'C. **Talk**, parley.',
    ];
    expect(filterOptionsAgainstSheet(options, SHEET)).toEqual([options[0], options[2]]);
  });

  it('passes non-string entries through untouched', () => {
    const options: unknown[] = ['A. **Fireball**, boom.', 42, null];
    expect(filterOptionsAgainstSheet(options, SHEET)).toEqual([42, null]);
  });

  it('normalizeCombatName lowercases and collapses whitespace', () => {
    expect(normalizeCombatName('  Fire   Bolt ')).toBe('fire bolt');
  });
});
