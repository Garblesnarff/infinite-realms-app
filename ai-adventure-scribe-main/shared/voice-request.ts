/**
 * Voice request bodies for the ElevenLabs proxy (#1348).
 *
 * The route in server-bun/src/routes/v1/tts.ts rejects any `text` longer than
 * VOICE_REQUEST_TEXT_MAX with 422. An older DM message can be longer than that
 * (a "Previously, on..." recap), so the client splits it into request-sized
 * pieces, one request per piece. Both sides import this module, so the client
 * and the route cannot drift apart.
 */

/** Longest `text` one proxy request may carry. tts.ts enforces the same value. */
export const VOICE_REQUEST_TEXT_MAX = 5000;

/**
 * Characters of premium-voice audio in one premium minute (#58).
 * 54,000 characters = 60 premium minutes a month, so one minute is 900
 * characters. Both sides import this module, so the server's monthly cap and
 * the account page's "minutes left" cannot drift apart.
 */
export const VOICE_CHARS_PER_MINUTE = 900;

/** Whole premium minutes in a character count (floored, never negative). */
export function voiceCharsToMinutes(characters: number): number {
  return Math.floor(Math.max(0, characters) / VOICE_CHARS_PER_MINUTE);
}

/**
 * Split text into pieces of at most `max` characters. Pieces break at sentence
 * ends where they can. The pieces, joined with '', give back the input exactly.
 */
export function splitVoiceText(text: string, max: number = VOICE_REQUEST_TEXT_MAX): string[] {
  if (text.length <= max) return [text];

  // Each match is one sentence with its closing punctuation and trailing space,
  // or a trailing run with no punctuation. Together the matches cover the text.
  const sentences = text.match(/[^.!?]*[.!?]+\s*|[^.!?]+$/g) ?? [text];
  const pieces: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    let rest = sentence;
    // A single sentence longer than the limit is cut at the limit.
    while (rest.length > max) {
      if (current) {
        pieces.push(current);
        current = '';
      }
      pieces.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    if (current.length + rest.length > max) {
      pieces.push(current);
      current = '';
    }
    current += rest;
  }
  if (current) pieces.push(current);

  return pieces;
}

export interface VoiceRequestOptions {
  model_id: string;
  voice_settings?: unknown;
  sessionId?: string;
}

/** The JSON bodies the proxy receives for `text`: one per piece, in order. */
export function buildVoiceRequestBodies(
  text: string,
  options: VoiceRequestOptions,
): Array<{ text: string; model_id: string; voice_settings?: unknown; sessionId?: string }> {
  return splitVoiceText(text).map((piece) => ({
    text: piece,
    model_id: options.model_id,
    voice_settings: options.voice_settings,
    sessionId: options.sessionId,
  }));
}
