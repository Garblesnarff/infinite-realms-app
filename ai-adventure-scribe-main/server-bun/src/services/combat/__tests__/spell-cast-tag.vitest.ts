/**
 * #709: pure unit tests for the sheet Cast tag extraction.
 *
 * No DB imports — safe for the vitest job.
 */
import { describe, expect, it } from 'vitest';

import { extractSpellIdFromPrompt } from '../spell-cast-tag.js';

describe('extractSpellIdFromPrompt', () => {
  it('extracts the spell id from the sheet Cast tag', () => {
    const prompt =
      'I cast Dancing Lights [spell_id=dancing-lights, spell_level=cantrip].';
    expect(extractSpellIdFromPrompt(prompt)).toBe('dancing-lights');
  });

  it('extracts the spell id when the tag has no trailing comma', () => {
    expect(extractSpellIdFromPrompt('I cast Bless [spell_id=bless]')).toBe('bless');
  });

  it('returns null when there is no tag', () => {
    expect(extractSpellIdFromPrompt('I cast Dancing Lights')).toBeNull();
  });

  it('returns null for an empty prompt', () => {
    expect(extractSpellIdFromPrompt('')).toBeNull();
  });
});
