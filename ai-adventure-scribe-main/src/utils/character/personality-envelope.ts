/**
 * #2701: the personality envelope persisted in the `personality_notes` column.
 *
 * This is a leaf module: it imports only the `Character` type (erased at
 * compile time), so `types/character.ts` can use the serializer without
 * pulling in game data (classes, races, backgrounds).
 *
 * Storage shape (also the shape #2703 builds on): the column holds either
 * the JSON envelope
 * `{traits, ideals, bonds, flaws, inspiration, lastInspiration,
 *   inspirationHistory, legacyNotes?}`
 * or legacy plain text, which is migrated into the envelope as `legacyNotes`
 * on first parse. AI prompt builders and other raw readers of the column
 * should parse the envelope rather than injecting the raw string.
 */
import type { Character } from '@/types/character';

/**
 * #2701: the personality envelope persisted in the `personality_notes` column.
 * The sheet's trait/ideal/bond/flaw arrays and inspiration state have no
 * dedicated columns, so they travel as one JSON document through the existing
 * `personality_notes` field (accepted by PUT /v1/characters/:id and whitelisted
 * by prepareCharacterPayload). Legacy plain-text values are preserved as
 * `legacyNotes` so the first trait edit does not erase them.
 */
export interface SheetPersonalityEnvelope {
  traits: string[];
  ideals: string[];
  bonds: string[];
  flaws: string[];
  inspiration: boolean;
  lastInspiration?: string | null;
  inspirationHistory: Array<{
    date: string;
    trigger: string;
    source: string;
    description: string;
  }>;
  /**
   * Plain-text personality notes written before the envelope existed (or by
   * flows that never hydrated). Kept inside the envelope so a trait edit no
   * longer erases them; the sheet shows them in the Personality Notes card.
   * This is the storage shape #2703 builds on.
   */
  legacyNotes?: string;
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];

/**
 * Parses envelope JSON strictly: returns the envelope only when the value is
 * actually an envelope document, null for legacy plain text or malformed
 * JSON. Used to avoid nesting an envelope inside `legacyNotes`.
 */
const tryParseEnvelopeJson = (raw: string): SheetPersonalityEnvelope | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const p = parsed as Record<string, unknown>;
  // An envelope is recognized by its array fields; anything else is legacy.
  if (
    !Array.isArray(p.traits) &&
    !Array.isArray(p.ideals) &&
    !Array.isArray(p.bonds) &&
    !Array.isArray(p.flaws) &&
    typeof p.legacyNotes !== 'string'
  ) {
    return null;
  }
  const history = Array.isArray(p.inspirationHistory)
    ? (p.inspirationHistory as Array<Record<string, unknown>>)
        .filter((e) => e && typeof e === 'object')
        .map((e) => ({
          date: typeof e.date === 'string' ? e.date : '',
          trigger: typeof e.trigger === 'string' ? e.trigger : '',
          source: typeof e.source === 'string' ? e.source : '',
          description: typeof e.description === 'string' ? e.description : '',
        }))
    : [];
  return {
    traits: asStringArray(p.traits),
    ideals: asStringArray(p.ideals),
    bonds: asStringArray(p.bonds),
    flaws: asStringArray(p.flaws),
    inspiration: p.inspiration === true,
    lastInspiration: typeof p.lastInspiration === 'string' ? p.lastInspiration : null,
    inspirationHistory: history,
    ...(typeof p.legacyNotes === 'string' && p.legacyNotes ? { legacyNotes: p.legacyNotes } : {}),
  };
};

/**
 * Parses the personality envelope. A stored value that is not envelope JSON
 * (legacy plain-text notes, or malformed JSON) is preserved as `legacyNotes`
 * on an otherwise empty envelope — never dropped. Returns null only for
 * missing/empty values.
 */
export const parsePersonalityEnvelope = (
  raw: string | null | undefined,
): SheetPersonalityEnvelope | null => {
  if (!raw) return null;
  const parsed = tryParseEnvelopeJson(raw);
  if (parsed) return parsed;
  return {
    traits: [],
    ideals: [],
    bonds: [],
    flaws: [],
    inspiration: false,
    lastInspiration: null,
    inspirationHistory: [],
    legacyNotes: raw,
  };
};

/**
 * Serializes the sheet's personality state into the envelope. Key order is
 * fixed so the output is canonical — the update diff compares envelopes as
 * strings.
 *
 * `character.personality_notes` is plain legacy text by contract (hydration
 * extracts it from the envelope; it is never envelope JSON), so it is kept
 * as `legacyNotes`. If it ever does hold envelope JSON, its arrays are
 * already the character's arrays — keep the stored document as-is rather
 * than nesting it.
 */
export const serializePersonalityEnvelope = (character: Character): string => {
  const raw = character.personality_notes;
  // Already an envelope document: keep it as-is rather than nesting it.
  if (raw && tryParseEnvelopeJson(raw)) return raw;
  return JSON.stringify({
    traits: character.personalityTraits ?? [],
    ideals: character.ideals ?? [],
    bonds: character.bonds ?? [],
    flaws: character.flaws ?? [],
    inspiration: character.inspiration ?? false,
    lastInspiration: character.personalityIntegration?.lastInspiration ?? null,
    inspirationHistory: character.personalityIntegration?.inspirationHistory ?? [],
    ...(raw ? { legacyNotes: raw } : {}),
  } satisfies SheetPersonalityEnvelope);
};
