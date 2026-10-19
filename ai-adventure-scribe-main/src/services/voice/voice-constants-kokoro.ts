import { IR_VOICES } from '../../../shared/npc-voices';
/**
 * Kokoro-82M voice for each VOICE_CONFIGS category key.
 *
 * Ids come from KokoroTTS#list_voices() (kokoro-js 1.2.1). Picked for the
 * character of the premium voice they stand in for; grades in comments are
 * Kokoro's own overallGrade. A test asserts every VOICE_CONFIGS key is mapped.
 */
export const KOKORO_VOICE_BY_CATEGORY = {
  narrator: IR_VOICES.narrator.kokoro, // British male storyteller (C)
  hero_male: IR_VOICES.thomas.kokoro, // (C+)
  hero_female: IR_VOICES.fena.kokoro, // (A-)
  villain_male: IR_VOICES.oxley.kokoro, // (C)
  villain_female: IR_VOICES.jessica.kokoro, // (B-)
  monster: IR_VOICES.kallixis.kokoro, // deepest male (C+)
  goblin: IR_VOICES.mouse.kokoro, // light, comic (C+)
  guard: 'bm_lewis', // (D+)
  merchant: IR_VOICES.nathan.kokoro, // (D)
  innkeeper: IR_VOICES.serena.kokoro, // warmest, best-graded (A)
  child: IR_VOICES.billy.kokoro, // lightest (C-)
  elder: IR_VOICES.sam.kokoro, // (D)
  default: IR_VOICES.narrator.kokoro, // same as narrator, mirroring VOICE_CONFIGS
} as const satisfies Record<string, string>;

export type KokoroVoiceId =
  (typeof KOKORO_VOICE_BY_CATEGORY)[keyof typeof KOKORO_VOICE_BY_CATEGORY];

export const KOKORO_FALLBACK_VOICE: KokoroVoiceId = KOKORO_VOICE_BY_CATEGORY.narrator;

export function getKokoroVoiceForCategory(category: string): KokoroVoiceId {
  return (
    (KOKORO_VOICE_BY_CATEGORY as Record<string, KokoroVoiceId>)[category] ?? KOKORO_FALLBACK_VOICE
  );
}
