import { describe, expect, test } from 'bun:test';

import { normalizePartialNarration, normalizeReplyNarration } from '../narration-text.js';

/**
 * #1289: Esme's sheet and header held 28/28. The model footer said [HP 32/32].
 * The sanitizer has no engine HP (callers are normalizeReplyNarration and
 * normalizePartialNarration), so a footer must not show HP at all.
 * Fixture shape is the envelope those callers pass. No live DM.
 */
const ENGINE_HP = { current: 28, max: 28 };

const shown = (text: string): string => {
  const envelope: Record<string, unknown> = { text, options: [] };
  normalizeReplyNarration(envelope);
  return envelope.text as string;
};

const showsHpTheEngineDoesNotHold = (text: string): boolean => {
  for (const match of text.matchAll(/\[HP\s*:?\s*(\d+)(?:\s*\/\s*(\d+|\?))?\s*\]/gi)) {
    const current = Number(match[1]);
    const max = match[2] && match[2] !== '?' ? Number(match[2]) : ENGINE_HP.max;
    if (current !== ENGINE_HP.current || max !== ENGINE_HP.max) return true;
  }
  return false;
};

describe('DM footer HP matches the engine or is absent (#1289)', () => {
  test('the Hark footer does not show 32/32 when the engine holds 28/28', () => {
    const text = shown('The bell rings. [HP 32/32] [Clock 0/6] [Pledges left 3]');
    expect(text).toBe('The bell rings.');
    expect(showsHpTheEngineDoesNotHold(text)).toBe(false);
    expect(text).not.toContain('[HP');
  });

  test('a trailing ellipsis does not keep the fabricated HP', () => {
    const text = shown('The bell rings. [HP 32/32] [Clock 0/6] [Pledges left 3]…');
    expect(text).toContain('The bell rings.');
    expect(showsHpTheEngineDoesNotHold(text)).toBe(false);
    expect(text).not.toContain('32');
  });

  test('a lone trailing HP bracket is dropped', () => {
    const text = shown('The bell rings. [HP 32/32]');
    expect(text).toBe('The bell rings.');
    expect(showsHpTheEngineDoesNotHold(text)).toBe(false);
  });

  test('a tracker-only reply does not come back with the model HP', () => {
    const text = shown('[HP 32/32] [Clock 0/6]');
    expect(text.trim()).not.toBe('');
    expect(showsHpTheEngineDoesNotHold(text)).toBe(false);
    expect(text).not.toContain('[HP');
  });

  test('an HP-only reply stays non-empty and does not show 32/32', () => {
    const text = shown('[HP 32/32]');
    expect(text.trim()).not.toBe('');
    expect(showsHpTheEngineDoesNotHold(text)).toBe(false);
  });

  test('the stream preview does not emit the footer HP', () => {
    const preview = normalizePartialNarration(
      'The bell rings. [HP 32/32] [Clock 0/6] [Pledges left 3]…',
    );
    expect(showsHpTheEngineDoesNotHold(preview)).toBe(false);
    expect(preview).not.toContain('[HP');
    const open = normalizePartialNarration('The bell rings. [HP 32/32] [Pledges left');
    expect(showsHpTheEngineDoesNotHold(open)).toBe(false);
    expect(open).not.toContain('[HP');
  });

  test('an HP mention that is not a footer stays', () => {
    const input = 'The sign reads [HP 32/32] above the door.';
    expect(shown(input)).toBe(input);
  });

  test('a sentence period after a lone HP bracket stays', () => {
    const input = 'The sign reads [HP 32/32].';
    expect(shown(input)).toBe(input);
    expect(normalizePartialNarration(input)).toBe(input);
  });

  test('a punctuated bracket run with no HP group stays', () => {
    const lines = [
      'She turns. [The door creaks] [Scene: cellar].',
      'You swing. [1d20] [Clock 0/6].',
      'You swing. [1d20+5].',
    ];
    for (const input of lines) {
      expect(shown(input)).toBe(input);
      expect(normalizePartialNarration(input)).toBe(input);
    }
  });
});
