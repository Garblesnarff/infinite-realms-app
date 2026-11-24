import { describe, expect, it } from 'vitest';

import {
  checkHeroName,
  HERO_NAME_MAX_LENGTH,
  heroEpithetName,
  suggestHeroNames,
} from '../hero-names';

describe('suggestHeroNames (#1741)', () => {
  it('offers three distinct names from the hero race', () => {
    const names = suggestHeroNames({ id: 'premade-a', race: 'Human' });
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names.every((name) => /^\p{L}+$/u.test(name))).toBe(true);
  });

  it('gives the same three names for the same premade every time', () => {
    const first = suggestHeroNames({ id: 'premade-a', race: 'Elf' });
    const second = suggestHeroNames({ id: 'premade-a', race: 'Elf' });
    expect(second).toEqual(first);
  });

  it('can give a different set to a different premade of the same race', () => {
    const sets = ['premade-a', 'premade-b', 'premade-c', 'premade-d'].map((id) =>
      suggestHeroNames({ id, race: 'Dwarf' }).join('|'),
    );
    expect(new Set(sets).size).toBeGreaterThan(1);
  });

  it('draws on the race pool, so a dwarf gets dwarf names', () => {
    const dwarfPool = ['Garrek', 'Dagna', 'Holm', 'Ulfra', 'Brokk', 'Hilde', 'Runa', 'Dorin'];
    for (const id of ['x1', 'x2', 'x3']) {
      for (const name of suggestHeroNames({ id, race: 'dwarf' })) {
        expect(dwarfPool).toContain(name);
      }
    }
  });

  it('falls back to a general pool for a race with no table', () => {
    const names = suggestHeroNames({ id: 'premade-a', race: 'Aarakocra' });
    expect(names).toHaveLength(3);
  });
});

describe('checkHeroName (#1741)', () => {
  it('keeps the premade title when the field is empty', () => {
    expect(checkHeroName('', 'The Seeker')).toEqual({ ok: true, name: 'The Seeker' });
    expect(checkHeroName('   ', 'The Seeker')).toEqual({ ok: true, name: 'The Seeker' });
  });

  it('trims the typed name', () => {
    expect(checkHeroName('  Mara  ', 'The Seeker')).toEqual({ ok: true, name: 'Mara' });
  });

  it('accepts letters, spaces, apostrophes and hyphens', () => {
    expect(checkHeroName("Mary-Jane O'Neil", 'The Veteran').ok).toBe(true);
    expect(checkHeroName('Ilse ’the Brave’', 'The Veteran').ok).toBe(true);
  });

  it('refuses digits and other symbols', () => {
    expect(checkHeroName('Mara2', 'The Seeker').ok).toBe(false);
    expect(checkHeroName('<b>Mara</b>', 'The Seeker').ok).toBe(false);
    expect(checkHeroName('-Mara', 'The Seeker').ok).toBe(false);
  });

  it('allows exactly 40 characters and refuses 41', () => {
    const forty = 'a'.repeat(HERO_NAME_MAX_LENGTH);
    expect(checkHeroName(forty, 'The Seeker')).toEqual({ ok: true, name: forty });
    expect(checkHeroName(`${forty}a`, 'The Seeker').ok).toBe(false);
  });
});

describe('heroEpithetName (#1741)', () => {
  it('shows the title as an epithet after the name', () => {
    expect(heroEpithetName('Mara', 'The Seeker')).toBe('Mara, the Seeker');
  });

  it('shows only the title when the name is the title', () => {
    expect(heroEpithetName('The Seeker', 'The Seeker')).toBe('The Seeker');
  });
});
