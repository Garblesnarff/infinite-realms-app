/**
 * Metamagic options stored in the character's personality envelope (#1233). The envelope is the
 * JSON document in `personality_notes`; the client owns its shape, and the server reads and
 * writes only the `metamagicOptions` key, leaving every other key as it found it.
 */
import {
  validateMetamagicOptionList,
  type MetamagicOptionId,
} from '../../../shared/metamagic-options';

const parseEnvelope = (
  personalityNotes: string | null | undefined,
): Record<string, unknown> | null => {
  if (!personalityNotes) return null;
  try {
    const parsed: unknown = JSON.parse(personalityNotes);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/**
 * The known Metamagic options a Sorcerer of `sorcererLevel` may use. Fail closed: no envelope, no
 * key, an invalid key, or a list longer than the cap all read as no options at all.
 */
export const metamagicOptionsFromEnvelope = (
  personalityNotes: string | null | undefined,
  sorcererLevel: number,
): MetamagicOptionId[] => {
  const envelope = parseEnvelope(personalityNotes);
  if (!envelope || !('metamagicOptions' in envelope)) return [];
  const checked = validateMetamagicOptionList(envelope.metamagicOptions, sorcererLevel);
  return checked.ok ? checked.options : [];
};

/**
 * The write-side check: a stored envelope whose `metamagicOptions` key is present must validate
 * against the Sorcerer level being written. An envelope with no such key always passes.
 */
export const checkEnvelopeMetamagic = (
  personalityNotes: string | null | undefined,
  sorcererLevel: number,
): { ok: true } | { ok: false; reason: string } => {
  const envelope = parseEnvelope(personalityNotes);
  if (!envelope || !('metamagicOptions' in envelope)) return { ok: true };
  const checked = validateMetamagicOptionList(envelope.metamagicOptions, sorcererLevel);
  return checked.ok ? { ok: true } : { ok: false, reason: checked.reason };
};
