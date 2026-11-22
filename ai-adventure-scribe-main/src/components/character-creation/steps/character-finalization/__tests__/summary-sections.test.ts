import { describe, expect, it } from 'vitest';

import {
  summarizeEnhancements,
  summarizePhysicalTraits,
  summarizeSpells,
} from '../summary-sections';

describe('summarizeSpells', () => {
  it('maps spell ids to display names', () => {
    const result = summarizeSpells({
      cantrips: ['fire-bolt'],
      knownSpells: ['magic-missile'],
      preparedSpells: [],
    });
    expect(result.cantrips).toEqual(['Fire Bolt']);
    expect(result.spells).toEqual(['Magic Missile']);
  });

  it('dedupes spells across known and prepared', () => {
    const result = summarizeSpells({
      cantrips: [],
      knownSpells: ['magic-missile', 'magic-missile'],
      preparedSpells: ['magic-missile'],
    });
    expect(result.spells).toEqual(['Magic Missile']);
  });

  it('falls back to raw string for unknown spells', () => {
    const result = summarizeSpells({
      cantrips: [],
      knownSpells: ['zzz-unknown-spell'],
      preparedSpells: [],
    });
    expect(result.spells).toEqual(['zzz-unknown-spell']);
  });

  it('ignores empty strings', () => {
    const result = summarizeSpells({
      cantrips: ['', 'fire-bolt'],
      knownSpells: [''],
      preparedSpells: [],
    });
    expect(result.cantrips).toEqual(['Fire Bolt']);
    expect(result.spells).toEqual([]);
  });

  it('trims a spaced spell id', () => {
    const result = summarizeSpells({
      cantrips: [' fire-bolt '],
      knownSpells: [],
      preparedSpells: [],
    });
    expect(result.cantrips).toEqual(['Fire Bolt']);
  });

  it('resolves a display-name entry and dedupes with its id', () => {
    const result = summarizeSpells({
      cantrips: [],
      knownSpells: ['Magic Missile', 'magic-missile'],
      preparedSpells: [],
    });
    expect(result.spells).toEqual(['Magic Missile']);
  });
});

describe('summarizeEnhancements', () => {
  it('looks up label for quirks with array value', () => {
    const result = summarizeEnhancements({
      enhancementSelections: [{ optionId: 'quirks', value: ['Counts everything they encounter'] }],
    });
    expect(result).toEqual([
      { label: 'Character Quirks', value: 'Counts everything they encounter' },
    ]);
  });

  it('skips empty values', () => {
    const result = summarizeEnhancements({
      enhancementSelections: [
        { optionId: 'quirks', value: [] },
        { optionId: 'quirks', value: '' },
        { optionId: 'unknown', value: '   ' },
      ],
    });
    expect(result).toEqual([]);
  });

  it('uses customValue when non-blank', () => {
    const result = summarizeEnhancements({
      enhancementSelections: [{ optionId: 'quirks', value: ['a'], customValue: 'Custom quirk' }],
    });
    expect(result).toEqual([{ label: 'Character Quirks', value: 'Custom quirk' }]);
  });

  it('keeps a selection with empty value but non-blank customValue', () => {
    const result = summarizeEnhancements({
      enhancementSelections: [{ optionId: 'quirks', value: '', customValue: 'Custom quirk' }],
    });
    expect(result).toEqual([{ label: 'Character Quirks', value: 'Custom quirk' }]);
  });

  it('falls back label to optionId', () => {
    const result = summarizeEnhancements({
      enhancementSelections: [{ optionId: 'mystery', value: 5 }],
    });
    expect(result).toEqual([{ label: 'mystery', value: '5' }]);
  });
});

describe('summarizePhysicalTraits', () => {
  it('formats traits including height 70 -> 5\'10"', () => {
    const result = summarizePhysicalTraits({
      gender: 'female',
      age: 27,
      height: 70,
      weight: 150,
      eyes: 'green',
      skin: 'tan',
      hair: 'black',
    });
    expect(result).toEqual([
      { label: 'Gender', value: 'Female' },
      { label: 'Age', value: '27 years' },
      { label: 'Height', value: '5\'10"' },
      { label: 'Weight', value: '150 lbs' },
      { label: 'Eyes', value: 'green' },
      { label: 'Skin', value: 'tan' },
      { label: 'Hair', value: 'black' },
    ]);
  });

  it('formats age 1 as 1 year', () => {
    const result = summarizePhysicalTraits({ age: 1 });
    expect(result).toEqual([{ label: 'Age', value: '1 year' }]);
  });

  it('returns empty array when nothing set', () => {
    expect(summarizePhysicalTraits({})).toEqual([]);
  });
});
