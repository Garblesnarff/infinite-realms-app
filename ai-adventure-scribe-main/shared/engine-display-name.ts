/**
 * Player-facing names for engine lines (#2306).
 *
 * One rule for every sentence a player reads: roster name, then the map entity's
 * name, then a title-cased slug. A UUID or a raw slug is never the text.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The word used when a monster swing has no authored `Attack (Name)` line. */
export const GENERIC_WEAPON_NAME = 'strike';

export type EngineRosterEntry = {
  id: string;
  name?: string | null;
  /**
   * The name a player reads, when it differs from the `name` the engine and the DM key on
   * (a bestiary creature seated under a DM-invented label shows the bible heading).
   * `name` still matches a reference; `displayName` only changes the text shown.
   */
  displayName?: string | null;
  /** Name on the tactical-map entity, when the roster row has none. */
  entityName?: string | null;
  slug?: string | null;
};

/**
 * A roster row for a combat participant. The bestiary display name travels on the stored
 * `monsterAttack` jsonb (there is no column for it), so every roster builder reads it here.
 */
export function rosterEntryForParticipant(participant: {
  id: string;
  name?: string | null;
  /** Client participants carry the heading directly; server rows carry it on `monsterAttack`. */
  displayName?: string | null;
  monsterAttack?: unknown;
}): EngineRosterEntry {
  const displayName =
    participant.displayName ??
    (participant.monsterAttack as { displayName?: unknown } | null | undefined)?.displayName;
  return {
    id: participant.id,
    name: participant.name ?? null,
    ...(typeof displayName === 'string' && displayName.trim() ? { displayName } : {}),
  };
}

export function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

/** Title-case a slug: split on `-` and `_`, join with spaces (`the-scholar` → `The Scholar`). */
export function titleCaseSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter((word) => word.length > 0 && !isUuid(word))
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** A stored token such as `the-scholar`, not a name a player should read. */
function isRawSlug(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || isUuid(trimmed) || /\s/.test(trimmed)) return false;
  return trimmed === trimmed.toLowerCase() && /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(trimmed);
}

function usableName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || isUuid(trimmed) || isRawSlug(trimmed)) return null;
  return trimmed;
}

function matches(entry: EngineRosterEntry, token: string): boolean {
  if (!token) return false;
  const normalized = slugify(token);
  if (entry.id === token) return true;
  if (entry.slug && (entry.slug === token || slugify(entry.slug) === normalized)) return true;
  const name = entry.name?.trim();
  if (name && (name === token || slugify(name) === normalized)) return true;
  const entityName = entry.entityName?.trim();
  if (entityName && (entityName === token || slugify(entityName) === normalized)) return true;
  return false;
}

/**
 * Resolve one actor or target. `Someone` is the last resort when the only token
 * is a UUID and the roster has no slug to title-case.
 */
export function displayNameFromRoster(
  ref: string | null | undefined,
  roster: readonly EngineRosterEntry[] = [],
): string {
  const token = (ref ?? '').trim();
  const entry = token ? roster.find((row) => matches(row, token)) : undefined;
  const rosterName = usableName(entry?.displayName) ?? usableName(entry?.name);
  if (rosterName) return rosterName;
  const entityName = usableName(entry?.entityName);
  if (entityName) return entityName;
  const provided = usableName(token);
  if (provided && !entry) return provided;

  const slug =
    (entry?.slug && !isUuid(entry.slug) ? entry.slug : null) ||
    (token && !isUuid(token) ? token : null);
  const titled = slug ? titleCaseSlug(slug) : '';
  if (titled && !isUuid(titled)) return titled;
  return 'Someone';
}

/** Prefer a roster hit on the id, then the name the payload already carried. */
export function facingName(
  provided: string | null | undefined,
  id: string | null | undefined,
  roster: readonly EngineRosterEntry[] = [],
): string {
  const token = id?.trim() ?? '';
  if (token && roster.some((row) => matches(row, token))) {
    return displayNameFromRoster(token, roster);
  }
  if (provided?.trim()) return displayNameFromRoster(provided, roster);
  if (token) return displayNameFromRoster(token, roster);
  return 'Someone';
}

/**
 * Weapon text for an engine line.
 *
 * A bare `attack`, or exactly `<actor display name> attack`, becomes
 * {@link GENERIC_WEAPON_NAME}. Authored names that merely end in "Attack"
 * (`Sneak Attack`, `Opportunity Attack`) are kept.
 */
export function playerFacingWeaponName(
  name: string | null | undefined,
  actorName?: string | null,
): string {
  const trimmed = name?.trim() ?? '';
  if (!trimmed || trimmed.toLowerCase() === 'attack') return GENERIC_WEAPON_NAME;
  const actor = actorName?.trim().toLowerCase();
  if (actor && trimmed.toLowerCase() === `${actor} attack`) return GENERIC_WEAPON_NAME;
  return trimmed;
}

/**
 * The AC phrase on a player-facing engine line.
 *
 * The roll is compared to seated AC plus cover. When cover added anything, say so:
 * `vs AC 12 (+2 half cover = 14)`. Otherwise `vs AC 12`, which is also what the tracker shows.
 */
export function formatVersusArmorClass(facts: {
  targetAC?: number | null;
  baseAc?: number | null;
  coverBonus?: number | null;
  cover?: number | null;
}): string {
  const effective = facts.targetAC;
  if (effective == null || !Number.isFinite(effective)) return 'vs AC ?';
  const base = facts.baseAc;
  const bonus = facts.coverBonus;
  if (
    base != null &&
    Number.isFinite(base) &&
    bonus != null &&
    Number.isFinite(bonus) &&
    bonus > 0
  ) {
    const kind = facts.cover === 2 || bonus >= 5 ? 'three-quarters cover' : 'half cover';
    return `vs AC ${base} (+${bonus} ${kind} = ${effective})`;
  }
  return `vs AC ${effective}`;
}
