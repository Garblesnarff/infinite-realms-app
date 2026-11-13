/**
 * #1233: the stored Metamagic list is read fail closed and checked against the 2014 cap. The cap
 * is 2 at Sorcerer 3, 3 at 10, 4 at 17; a list over the cap, an unknown id, a duplicate, or no
 * envelope reads as no options.
 */
import { describe, expect, test } from 'bun:test';

import { metamagicOptionCap } from '../../../../shared/metamagic-options';
import {
  checkEnvelopeMetamagic,
  checkMetamagicRepick,
  metamagicOptionsFromEnvelope,
} from '../character-metamagic';

const envelope = (options: unknown) => JSON.stringify({ traits: [], metamagicOptions: options });

describe('metamagic cap and reads (#1233)', () => {
  test('the 2014 cap by Sorcerer level', () => {
    expect([2, 3, 9, 10, 16, 17, 20].map(metamagicOptionCap)).toEqual([0, 2, 2, 3, 3, 4, 4]);
  });

  test('a list within the cap is read in stored order', () => {
    expect(metamagicOptionsFromEnvelope(envelope(['quickened', 'careful']), 3)).toEqual([
      'quickened',
      'careful',
    ]);
  });

  test('three options at level 3 read as none, and fail the write check', () => {
    const three = envelope(['quickened', 'careful', 'subtle']);
    expect(metamagicOptionsFromEnvelope(three, 3)).toEqual([]);
    expect(checkEnvelopeMetamagic(three, 3).ok).toBe(false);
    expect(metamagicOptionsFromEnvelope(envelope(['quickened', 'careful', 'subtle']), 10)).toEqual([
      'quickened',
      'careful',
      'subtle',
    ]);
  });

  test('an unknown id, a duplicate, or a non-list reads as none', () => {
    expect(metamagicOptionsFromEnvelope(envelope(['haste']), 3)).toEqual([]);
    expect(metamagicOptionsFromEnvelope(envelope(['quickened', 'quickened']), 3)).toEqual([]);
    expect(metamagicOptionsFromEnvelope(envelope('quickened'), 3)).toEqual([]);
  });

  test('no envelope, legacy text, or a level below 3 reads as none', () => {
    expect(metamagicOptionsFromEnvelope(null, 3)).toEqual([]);
    expect(metamagicOptionsFromEnvelope('plain notes', 3)).toEqual([]);
    expect(metamagicOptionsFromEnvelope(envelope(['quickened']), 2)).toEqual([]);
  });

  test('an envelope with no metamagic key always passes the write check', () => {
    expect(checkEnvelopeMetamagic(JSON.stringify({ traits: ['x'] }), 1).ok).toBe(true);
  });

  test('a first pick is accepted when no list is stored', () => {
    expect(checkMetamagicRepick(null, envelope(['quickened', 'careful']), 3).ok).toBe(true);
    expect(
      checkMetamagicRepick(JSON.stringify({ traits: [] }), envelope(['quickened']), 3).ok,
    ).toBe(true);
  });

  test('the same list is accepted, in any order', () => {
    const stored = envelope(['quickened', 'careful']);
    expect(checkMetamagicRepick(stored, envelope(['quickened', 'careful']), 3).ok).toBe(true);
    expect(checkMetamagicRepick(stored, envelope(['careful', 'quickened']), 3).ok).toBe(true);
  });

  test('a swap is refused', () => {
    const verdict = checkMetamagicRepick(
      envelope(['quickened', 'careful']),
      envelope(['quickened', 'subtle']),
      3,
    );
    expect(verdict.ok).toBe(false);
  });

  test('a shrink and a removal are refused', () => {
    const stored = envelope(['quickened', 'careful']);
    expect(checkMetamagicRepick(stored, envelope(['quickened']), 10).ok).toBe(false);
    expect(checkMetamagicRepick(stored, JSON.stringify({ traits: [] }), 10).ok).toBe(false);
  });

  test('a grow is accepted only when the cap allows more: level 10 yes, level 3 no', () => {
    const stored = envelope(['quickened', 'careful']);
    expect(checkMetamagicRepick(stored, envelope(['quickened', 'careful', 'subtle']), 10).ok).toBe(
      true,
    );
    expect(checkMetamagicRepick(stored, envelope(['quickened', 'careful', 'subtle']), 3).ok).toBe(
      false,
    );
  });

  test('a grow that keeps every stored option and adds one at 17th level is accepted', () => {
    const stored = envelope(['quickened', 'careful', 'subtle']);
    expect(
      checkMetamagicRepick(stored, envelope(['quickened', 'careful', 'subtle', 'twinned']), 17).ok,
    ).toBe(true);
  });
});
