/**
 * #1508: the server's merge of the character envelope stored in `personality_notes`.
 *
 * The client owns the envelope's sheet keys (traits, ideals, bonds, flaws, history, notes,
 * metamagicOptions). The engine owns `inspiration`: it is granted by the DM and spent by the
 * engine's spend route, never by a client body. A PUT therefore merges onto the stored document:
 * an engine-owned key is always the stored value (or absent), a key the client sends replaces the
 * stored one, and a key the client omits keeps the stored one.
 */

/**
 * Keys the engine writes, with the value they read as when nothing is stored. A client body never
 * sets them; the stored value is kept, and an absent key is written as its default.
 */
export const ENGINE_OWNED_ENVELOPE_DEFAULTS: Readonly<Record<string, unknown>> = {
  inspiration: false,
};

export type EnvelopeObject = Record<string, unknown>;

/** The envelope document, or null when the value is not a JSON object (null, empty, plain text). */
export function parseEnvelopeObject(raw: string | null | undefined): EnvelopeObject | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as EnvelopeObject)
      : null;
  } catch {
    return null;
  }
}

/** The stored Inspiration flag. No envelope, no key, or a non-boolean key reads as not held. */
export function envelopeInspiration(raw: string | null | undefined): boolean {
  return parseEnvelopeObject(raw)?.inspiration === true;
}

export type EnvelopeMerge =
  /** The client sent no envelope: the stored column is left as it is. */
  | { kind: 'keep' }
  /** The merged document to store. */
  | { kind: 'write'; value: string }
  /** The client sent a value that is not an envelope object. */
  | { kind: 'refuse'; reason: string };

/**
 * Merges a client envelope onto the stored one. Null, undefined, empty and whitespace-only values
 * are "no envelope" and keep the stored column. Engine-owned keys are taken from the stored
 * document only, so a client value for them is dropped and an absent stored key stays absent.
 */
export function mergeClientEnvelope(
  stored: string | null | undefined,
  incoming: string | null | undefined,
): EnvelopeMerge {
  if (incoming === null || incoming === undefined || incoming.trim() === '') {
    return { kind: 'keep' };
  }
  const client = parseEnvelopeObject(incoming);
  if (!client) {
    return {
      kind: 'refuse',
      reason: 'personality_notes must be the character envelope as a JSON object',
    };
  }
  const storedObject = parseEnvelopeObject(stored) ?? {};
  const merged: EnvelopeObject = { ...storedObject, ...client };
  for (const [key, fallback] of Object.entries(ENGINE_OWNED_ENVELOPE_DEFAULTS)) {
    merged[key] = key in storedObject ? storedObject[key] : fallback;
  }
  return { kind: 'write', value: JSON.stringify(merged) };
}

/**
 * For a create, where nothing is stored yet: the client's engine-owned keys are removed and the
 * rest of the value is kept as the client sent it. A value that is not an envelope object is
 * returned unchanged, so legacy plain-text notes on create still store.
 */
export function withoutEngineOwnedKeys(raw: string | null | undefined): string | null | undefined {
  const parsed = parseEnvelopeObject(raw);
  if (!parsed) return raw;
  const kept: EnvelopeObject = { ...parsed };
  for (const key of Object.keys(ENGINE_OWNED_ENVELOPE_DEFAULTS)) delete kept[key];
  return JSON.stringify(kept);
}
