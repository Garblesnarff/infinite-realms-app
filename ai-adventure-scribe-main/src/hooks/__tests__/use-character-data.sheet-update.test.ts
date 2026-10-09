/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * #2701: the sheet's save path builds a PUT payload from the character diff.
 * These tests pin the exact wire bodies the client sends for each QA-listed
 * edit — the real-DB suite replays these same bodies against PUT
 * /v1/characters/:id and reads the rows back.
 */
import { describe, it, expect } from 'vitest';

import { buildSheetUpdatePayload } from '../use-character-data';

import type { Character } from '@/types/character';

import {
  parsePersonalityEnvelope,
  serializePersonalityEnvelope,
  transformCharacterData,
} from '@/utils/character/data-transformers';

const baseCharacter = (): Character =>
  ({
    id: 'char-1',
    name: 'Test Hero',
    level: 1,
    experience: 0,
    sessionNotes: '',
    appearance: '',
    description: '',
    backstory_elements: '',
    personality_traits: '',
    personalityTraits: [],
    ideals: [],
    bonds: [],
    flaws: [],
    inspiration: false,
  }) as Character;

describe('buildSheetUpdatePayload (#2701)', () => {
  it('award XP produces exactly { experience_points }', () => {
    const prev = baseCharacter();
    const next = { ...prev, experience: 100 };
    expect(buildSheetUpdatePayload(prev, next)).toEqual({ experience_points: 100 });
  });

  it('quick level set produces the XP for the target level', () => {
    const prev = baseCharacter();
    const next = { ...prev, experience: 6500 };
    expect(buildSheetUpdatePayload(prev, next)).toEqual({ experience_points: 6500 });
  });

  it('save appearance produces exactly { appearance }', () => {
    const prev = baseCharacter();
    const next = { ...prev, appearance: 'Tall, scarred, silver hair.' };
    expect(buildSheetUpdatePayload(prev, next)).toEqual({
      appearance: 'Tall, scarred, silver hair.',
    });
  });

  it('save personality (free text) produces exactly { personality_traits }', () => {
    const prev = baseCharacter();
    const next = { ...prev, personality_traits: 'Gruff but loyal.' };
    expect(buildSheetUpdatePayload(prev, next)).toEqual({
      personality_traits: 'Gruff but loyal.',
    });
  });

  it('session notes produce exactly { session_notes }', () => {
    const prev = baseCharacter();
    const next = { ...prev, sessionNotes: 'Met the innkeeper.' };
    expect(buildSheetUpdatePayload(prev, next)).toEqual({
      session_notes: 'Met the innkeeper.',
    });
  });

  it('adding a trait produces the personality envelope in personality_notes', () => {
    const prev = baseCharacter();
    const next = { ...prev, personalityTraits: ['Brave'] };
    const payload = buildSheetUpdatePayload(prev, next);

    expect(Object.keys(payload)).toEqual(['personality_notes']);
    const envelope = parsePersonalityEnvelope(payload.personality_notes as string);
    expect(envelope).not.toBeNull();
    expect(envelope!.traits).toEqual(['Brave']);
    expect(envelope!.ideals).toEqual([]);
    expect(envelope!.inspiration).toBe(false);
  });

  it('toggling inspiration changes only the envelope', () => {
    const prev = baseCharacter();
    const next = { ...prev, inspiration: true };
    const payload = buildSheetUpdatePayload(prev, next);

    expect(Object.keys(payload)).toEqual(['personality_notes']);
    expect(parsePersonalityEnvelope(payload.personality_notes as string)!.inspiration).toBe(true);
  });

  it('returns an empty payload when nothing sheet-managed changed', () => {
    const prev = baseCharacter();
    // A rest result touches vitals/resources the sheet never PUTs; its own
    // API already persisted it, so the sheet must not write.
    const next = { ...prev, hitPoints: { current: 5, max: 10 } } as unknown as Character;
    expect(buildSheetUpdatePayload(prev, next)).toEqual({});
  });

  it('returns an empty payload for identical characters', () => {
    const prev = baseCharacter();
    expect(buildSheetUpdatePayload(prev, { ...prev })).toEqual({});
  });

  it('returns an empty payload when there is no previous character', () => {
    expect(buildSheetUpdatePayload(null, baseCharacter())).toEqual({});
  });

  it('treats null and empty string as the same for text fields', () => {
    const prev = { ...baseCharacter(), appearance: null } as any as Character;
    const next = { ...baseCharacter(), appearance: '' };
    expect(buildSheetUpdatePayload(prev, next)).toEqual({});
  });
});

describe('personality envelope round-trip (#2701)', () => {
  it('serialize -> parse is stable and canonical', () => {
    const character = {
      ...baseCharacter(),
      personalityTraits: ['Brave'],
      ideals: ['Justice'],
      inspiration: true,
    };
    const raw = serializePersonalityEnvelope(character);
    expect(serializePersonalityEnvelope(character)).toBe(raw);
    const parsed = parsePersonalityEnvelope(raw)!;
    expect(parsed.traits).toEqual(['Brave']);
    expect(parsed.ideals).toEqual(['Justice']);
    expect(parsed.bonds).toEqual([]);
    expect(parsed.inspiration).toBe(true);
  });

  it('parse preserves legacy plain-text notes as legacyNotes instead of dropping them', () => {
    expect(parsePersonalityEnvelope('just some notes')).toEqual({
      traits: [],
      ideals: [],
      bonds: [],
      flaws: [],
      inspiration: false,
      lastInspiration: null,
      inspirationHistory: [],
      legacyNotes: 'just some notes',
    });
    expect(parsePersonalityEnvelope('{oops')?.legacyNotes).toBe('{oops');
    expect(parsePersonalityEnvelope(null)).toBeNull();
    expect(parsePersonalityEnvelope('')).toBeNull();
  });

  it('serialize keeps legacyNotes through a trait edit', () => {
    const character = {
      ...baseCharacter(),
      personalityTraits: ['Brave'],
      personality_notes: 'old notes',
    };
    const envelope = JSON.parse(serializePersonalityEnvelope(character));
    expect(envelope.traits).toEqual(['Brave']);
    expect(envelope.legacyNotes).toBe('old notes');
  });

  it('transformCharacterData hydrates the arrays from the envelope', () => {
    const character = { ...baseCharacter(), personalityTraits: ['Brave'], ideals: ['Justice'] };
    const row = {
      id: 'char-1',
      user_id: 'user-1',
      name: 'Test Hero',
      race: 'Human',
      class: 'Fighter',
      level: 1,
      experience_points: 0,
      personality_notes: serializePersonalityEnvelope(character),
    } as any;
    const hydrated = transformCharacterData(row, null, null);
    expect(hydrated.personalityTraits).toEqual(['Brave']);
    expect(hydrated.ideals).toEqual(['Justice']);
    expect(hydrated.bonds).toEqual([]);
    expect(hydrated.flaws).toEqual([]);
  });

  it('transformCharacterData falls back to empty arrays without an envelope', () => {
    const row = {
      id: 'char-1',
      user_id: 'user-1',
      name: 'Test Hero',
      race: 'Human',
      class: 'Fighter',
      level: 1,
      experience_points: 0,
      personality_notes: null,
    } as any;
    const hydrated = transformCharacterData(row, null, null);
    expect(hydrated.personalityTraits).toEqual([]);
    expect(hydrated.inspiration).toBe(false);
  });
});
