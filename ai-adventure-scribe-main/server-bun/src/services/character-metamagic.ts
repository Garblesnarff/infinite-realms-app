/**
 * Metamagic options stored in the character's personality envelope (#1233). The envelope is the
 * JSON document in `personality_notes`; the client owns its shape, and the server reads and
 * writes only the `metamagicOptions` key, leaving every other key as it found it.
 */
import {
  isMetamagicOptionId,
  metamagicOptionCap,
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

/**
 * The re-pick rule on a save (#1233, strategist FIX). A stored, non-empty list is fixed: the same
 * list is accepted, and a superset is accepted only when the cap now allows more than the stored
 * count (Sorcerer 10 or 17). A swap, a shrink, a removal, or a superset the cap does not allow is
 * refused. A character with no stored list may make its first pick.
 */
export const checkMetamagicRepick = (
  storedPersonalityNotes: string | null | undefined,
  incomingPersonalityNotes: string,
  sorcererLevel: number,
): { ok: true } | { ok: false; reason: string } => {
  const stored = parseEnvelope(storedPersonalityNotes);
  const storedList = Array.isArray(stored?.metamagicOptions)
    ? (stored.metamagicOptions as unknown[]).filter(isMetamagicOptionId)
    : [];
  if (storedList.length === 0) return { ok: true };
  const incoming = parseEnvelope(incomingPersonalityNotes);
  // A list the stored envelope has but the save does not is a removal, not a choice.
  if (!incoming || !('metamagicOptions' in incoming)) {
    return { ok: false, reason: repickRefusal(storedList) };
  }
  const list = incoming.metamagicOptions;
  // Shape and ids are the validator's to refuse (400); this rule only compares lists.
  if (!Array.isArray(list)) return { ok: true };
  const sameList =
    list.length === storedList.length && storedList.every((option) => list.includes(option));
  if (sameList) return { ok: true };
  const keepsAll = storedList.every((option) => list.includes(option));
  const grows =
    keepsAll && list.length > storedList.length && list.length <= metamagicOptionCap(sorcererLevel);
  if (grows) return { ok: true };
  return { ok: false, reason: repickRefusal(storedList) };
};

const repickRefusal = (storedList: readonly string[]) =>
  `Metamagic options cannot be swapped or removed once chosen. This Sorcerer knows ${storedList.join(', ')}; a new option can be added only when the level allows more (10th and 17th level).`;
