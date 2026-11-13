/**
 * #1233: the sheet's save round-trips the personality envelope (read-modify-write). A stored key
 * the sheet does not own must survive a save, and so must `metamagicOptions` and `inspiration`.
 * The test hydrates a stored row the way the GET does, edits one trait the way the sheet does, and
 * serializes the way the save does.
 */
import { describe, expect, it } from 'vitest';

import getRow1226 from '../../../../shared/test-fixtures/character-get-row-1226.json';
import { metamagicEnvelopeJson } from '../../../../shared/test-fixtures/metamagic-envelope';
import {
  parsePersonalityEnvelope,
  serializePersonalityEnvelope,
  transformCharacterData,
  type CharacterRow,
} from '../data-transformers';

const storedEnvelope = JSON.stringify({
  traits: ['Curious'],
  ideals: [],
  bonds: [],
  flaws: [],
  inspiration: true,
  inspirationHistory: [],
  metamagicOptions: ['quickened', 'careful'],
  futureField: { keep: 'me' },
});

const hydrate = () =>
  transformCharacterData(
    { ...(getRow1226 as unknown as CharacterRow), personality_notes: storedEnvelope },
    null,
    null,
  );

describe('personality envelope round-trip (#1233)', () => {
  it('a save keeps metamagicOptions, inspiration, and an unknown key', () => {
    const character = hydrate();
    // The sheet edits a trait and saves the whole character back.
    const saved = serializePersonalityEnvelope({
      ...character,
      personalityTraits: ['Curious', 'Bold'],
    });
    const envelope = JSON.parse(saved) as Record<string, unknown>;
    expect(envelope.metamagicOptions).toEqual(['quickened', 'careful']);
    expect(envelope.inspiration).toBe(true);
    expect(envelope.futureField).toEqual({ keep: 'me' });
    expect(envelope.traits).toEqual(['Curious', 'Bold']);
  });

  it('an unedited save writes the shared envelope bytes the server test posts', () => {
    const stored = metamagicEnvelopeJson(['quickened', 'careful']);
    const character = transformCharacterData(
      { ...(getRow1226 as unknown as CharacterRow), personality_notes: stored },
      null,
      null,
    );
    expect(serializePersonalityEnvelope(character)).toBe(stored);
  });

  it('a save without a list keeps the stored list and writes no empty key', () => {
    const bare = JSON.stringify({ traits: [], inspiration: false, inspirationHistory: [] });
    const character = transformCharacterData(
      { ...(getRow1226 as unknown as CharacterRow), personality_notes: bare },
      null,
      null,
    );
    const envelope = JSON.parse(serializePersonalityEnvelope(character)) as Record<string, unknown>;
    expect('metamagicOptions' in envelope).toBe(false);
  });

  it('parses the owned fields and reports the extras separately', () => {
    const parsed = parsePersonalityEnvelope(storedEnvelope);
    expect(parsed?.metamagicOptions).toEqual(['quickened', 'careful']);
    expect(parsed?.extras).toEqual({ futureField: { keep: 'me' } });
  });
});
