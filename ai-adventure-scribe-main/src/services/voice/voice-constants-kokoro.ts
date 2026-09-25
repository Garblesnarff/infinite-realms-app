/**
 * Kokoro-82M voice for each VOICE_CONFIGS category key.
 *
 * Ids come from KokoroTTS#list_voices() (kokoro-js 1.2.1). Picked for the
 * character of the premium voice they stand in for; grades in comments are
 * Kokoro's own overallGrade. A test asserts every VOICE_CONFIGS key is mapped.
 */
export const KOKORO_VOICE_BY_CATEGORY = {
  narrator: 'bm_fable', // British male storyteller (C)
  hero_male: 'am_michael', // (C+)
  hero_female: 'af_bella', // (A-)
  villain_male: 'bm_george', // (C)
  villain_female: 'bf_emma', // (B-)
  monster: 'am_fenrir', // deepest male (C+)
  goblin: 'am_puck', // light, comic (C+)
  guard: 'bm_lewis', // (D+)
  merchant: 'am_echo', // (D)
  innkeeper: 'af_heart', // warmest, best-graded (A)
  child: 'af_sky', // lightest (C-)
  elder: 'bm_daniel', // (D)
  default: 'bm_fable', // same as narrator, mirroring VOICE_CONFIGS
} as const satisfies Record<string, string>;

export type KokoroVoiceId =
  (typeof KOKORO_VOICE_BY_CATEGORY)[keyof typeof KOKORO_VOICE_BY_CATEGORY];

export const KOKORO_FALLBACK_VOICE: KokoroVoiceId = KOKORO_VOICE_BY_CATEGORY.narrator;

export function getKokoroVoiceForCategory(category: string): KokoroVoiceId {
  return (
    (KOKORO_VOICE_BY_CATEGORY as Record<string, KokoroVoiceId>)[category] ?? KOKORO_FALLBACK_VOICE
  );
}
