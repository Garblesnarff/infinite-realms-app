import { readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getVoiceCategoryKey } from '../voice-classification';
import { VOICE_CONFIGS } from '../voice-constants';
import { KOKORO_VOICE_BY_CATEGORY, getKokoroVoiceForCategory } from '../voice-constants-kokoro';
import { VOICE_POOLS } from '../voice-pools';

import { assignVoice, clearCharacterVoiceMappings } from '@/services/voice-routing';

// English voices shipped with the installed kokoro-js (what list_voices() prints);
// read from disk so no model or network is touched.
const SHIPPED_ENGLISH_VOICES = new Set(
  readdirSync(path.resolve(process.cwd(), 'node_modules/kokoro-js/voices'))
    .map((file) => file.replace(/\.bin$/, ''))
    .filter((id) => /^[ab][fm]_/.test(id)),
);

describe('Kokoro voice mapping', () => {
  it('maps every VOICE_CONFIGS category key', () => {
    expect(Object.keys(KOKORO_VOICE_BY_CATEGORY).sort()).toEqual(Object.keys(VOICE_CONFIGS).sort());
  });

  it.each(Object.entries(KOKORO_VOICE_BY_CATEGORY))(
    '%s -> %s is a voice kokoro-js ships',
    (_category, kokoroVoice) => {
      expect(SHIPPED_ENGLISH_VOICES.has(kokoroVoice)).toBe(true);
    },
  );

  it('falls back to the narrator voice for an unknown category', () => {
    expect(getKokoroVoiceForCategory('not-a-category')).toBe(KOKORO_VOICE_BY_CATEGORY.narrator);
  });
});

describe('getVoiceCategoryKey', () => {
  it('returns the key of a VOICE_CONFIGS entry by identity, even when ids are shared', () => {
    // hero_male and guard share an ElevenLabs id; the Kokoro voices differ.
    expect(getVoiceCategoryKey(VOICE_CONFIGS.guard)).toBe('guard');
    expect(getVoiceCategoryKey(VOICE_CONFIGS.hero_male)).toBe('hero_male');
    expect(getVoiceCategoryKey(VOICE_CONFIGS.default)).toBe('default');
  });

  it('resolves every pool voice to a category by its ElevenLabs id', () => {
    const poolVoices = Object.values(VOICE_POOLS).flat();
    for (const voice of poolVoices) {
      expect(VOICE_CONFIGS[getVoiceCategoryKey(voice)].id).toBe(voice.id);
    }
  });

  it('keeps the same Kokoro voice for the same character across segments', () => {
    clearCharacterVoiceMappings();
    const first = assignVoice({ type: 'character', text: 'Hi', character: 'Brakka the Goblin' });
    const second = assignVoice({
      type: 'character',
      text: 'Bye',
      character: 'Brakka the Goblin',
    });
    const categoryA = getVoiceCategoryKey(first);
    const categoryB = getVoiceCategoryKey(second);
    expect(getKokoroVoiceForCategory(categoryA)).toBe(getKokoroVoiceForCategory(categoryB));
    clearCharacterVoiceMappings();
  });
});
