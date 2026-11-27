/**
 * One canonical spell id (#254).
 *
 * The catalog carried two spells twice (SRD short name + PHB possessive
 * form). The SRD id is canonical; the possessive form is an alias. These
 * tests pin the server side: catalog resolution returns the canonical row
 * for either spelling, so `spellKey` — the comparison the DM feature gate
 * and the concentration check use — agrees and a cast named under one
 * alias is not refused when the character holds the other.
 */
import { describe, expect, it } from 'vitest';

import { spellKey } from '../../services/dm/castable-spells.js';
import { getSpellById, getSpellByName, resolveCatalogSpell } from '../spellData.js';

describe('canonical spell ids (#254)', () => {
  it('resolves a possessive alias id to the canonical row', () => {
    expect(getSpellById('tashas-hideous-laughter')?.id).toBe('hideous-laughter');
    expect(getSpellById('tensers-floating-disk')?.id).toBe('floating-disk');
    expect(resolveCatalogSpell('tashas-hideous-laughter')?.id).toBe('hideous-laughter');
    expect(resolveCatalogSpell('tensers-floating-disk')?.id).toBe('floating-disk');
  });

  it('resolves a possessive display name to the canonical row', () => {
    expect(resolveCatalogSpell("Tasha's Hideous Laughter")?.id).toBe('hideous-laughter');
    expect(resolveCatalogSpell("Tenser's Floating Disk")?.id).toBe('floating-disk');
  });

  it('counts a possessive display name as on-catalog by name', () => {
    expect(getSpellByName("Tasha's Hideous Laughter")?.id).toBe('hideous-laughter');
    expect(getSpellByName("Tenser's Floating Disk")?.id).toBe('floating-disk');
    expect(getSpellByName('Hideous Laughter')?.id).toBe('hideous-laughter');
    expect(getSpellByName('No Such Spell')).toBeUndefined();
  });

  it('keys both spellings of a spell the same in the prepared gate', () => {
    expect(spellKey('Hideous Laughter')).toBe(spellKey("Tasha's Hideous Laughter"));
    expect(spellKey('hideous-laughter')).toBe(spellKey('tashas-hideous-laughter'));
    expect(spellKey('Floating Disk')).toBe(spellKey("Tenser's Floating Disk"));
    expect(spellKey('floating-disk')).toBe(spellKey('tensers-floating-disk'));
  });

  it('keeps the canonical ids resolving', () => {
    expect(getSpellById('hideous-laughter')?.name).toBe('Hideous Laughter');
    expect(getSpellById('floating-disk')?.name).toBe('Floating Disk');
  });
});
