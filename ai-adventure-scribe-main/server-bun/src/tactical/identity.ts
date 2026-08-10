/**
 * Entity identity: slugs are what the LLM sees, UUIDs are what the engine stores.
 *
 * The DM addresses the board by copying tokens out of the tactical digest, and it
 * spells them back inconsistently ("shadow-roach-1", "shadow_roach_1", "seeker").
 * Every lookup that starts from model output therefore goes through
 * `resolveEntityRef` rather than an exact-match `find`, and every lookup that fails
 * produces a roster the model can be corrected with instead of a silent drop.
 */

/** Anything with a stable internal id and, optionally, an LLM-facing slug and name. */
export type EntityRef = { id: string; slug?: string; name?: string };

const LEADING_ARTICLE = /^(?:the|a|an)-/;

/**
 * Case, spacing, and separator differences are all noise: `Shadow_Roach 1` and
 * `shadow-roach-1` name the same creature. UUIDs survive this unchanged apart from case.
 */
export function normalizeEntityToken(token: string): string {
  return token
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

/** The slug form of a display name; identical to `normalizeEntityToken` by construction. */
export const slugify = normalizeEntityToken;

const withoutArticle = (normalized: string): string | null => {
  const stripped = normalized.replace(LEADING_ARTICLE, '');
  return stripped && stripped !== normalized ? stripped : null;
};

/** The token the DM is shown for an entity. Pre-slug maps fall back to the raw id. */
export const entitySlug = (entity: EntityRef): string => entity.slug || entity.id;

/**
 * Assigns slugs across a whole placement batch, which is the only point where
 * duplicate names are visible: a lone creature keeps its bare name (`the-seeker`),
 * while a group is numbered from one (`shadow-roach-1`, `shadow-roach-2`).
 */
export function assignEntitySlugs<T extends EntityRef>(entities: T[]): T[] {
  const taken = new Set<string>(entities.filter((e) => e.slug).map((e) => e.slug!));
  const groups = new Map<string, T[]>();
  for (const entity of entities) {
    if (entity.slug) continue;
    const base = slugify(entity.name || entity.id) || 'entity';
    const group = groups.get(base);
    if (group) group.push(entity);
    else groups.set(base, [entity]);
  }
  for (const [base, group] of groups) {
    group.forEach((entity, index) => {
      const preferred = group.length === 1 ? base : `${base}-${index + 1}`;
      entity.slug = uniqueSlug(preferred, taken);
      taken.add(entity.slug);
    });
  }
  return entities;
}

/** Assigns one slug against slugs already on the board; used for mid-combat placements. */
export function nextEntitySlug(existing: Iterable<EntityRef>, entity: EntityRef): string {
  const taken = new Set<string>();
  for (const other of existing) taken.add(entitySlug(other));
  return uniqueSlug(slugify(entity.name || entity.id) || 'entity', taken);
}

function uniqueSlug(preferred: string, taken: Set<string>): string {
  if (!taken.has(preferred)) return preferred;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${preferred}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Every spelling of an entity that is specific enough to be unambiguous on its own. */
function aliasesFor(entity: EntityRef): string[] {
  const aliases = [normalizeEntityToken(entity.id)];
  const slug = normalizeEntityToken(entitySlug(entity));
  const name = entity.name ? normalizeEntityToken(entity.name) : null;
  for (const form of [slug, name]) {
    if (!form) continue;
    aliases.push(form);
    const stripped = withoutArticle(form);
    if (stripped) aliases.push(stripped);
  }
  return [...new Set(aliases)];
}

/** A trailing one-based index, as the DM writes it whether or not the board numbered anything. */
const TRAILING_INDEX = /-\d+$/;

/**
 * The single resolver behind DM map actions, the spatial contract, and the player
 * move route. Ambiguity is a failure, not a coin flip: "shadow-roach" with two
 * roaches on the board resolves to nothing so the model gets corrected instead.
 */
export function resolveEntityRef<T extends EntityRef>(entities: T[], token: string): T | null {
  if (!token) return null;
  const exact = entities.find((entity) => entity.id === token);
  if (exact) return exact;
  const wanted = normalizeEntityToken(token);
  if (!wanted) return null;
  const byAlias = entities.filter((entity) => aliasesFor(entity).includes(wanted));
  if (byAlias.length) return byAlias.length === 1 ? byAlias[0] : null;
  // A prefix that names exactly one entity ("void" for "void-maw").
  const byPrefix = entities.filter((entity) =>
    aliasesFor(entity).some((alias) => alias.startsWith(`${wanted}-`)),
  );
  if (byPrefix.length === 1) return byPrefix[0];
  /**
   * Last resort, and the inverse of the tier above: the token is one an alias *prefixes*,
   * numbered. `assignEntitySlugs` numbers a name only when the board carries more than one
   * creature answering to it, so a lone `Sentient Glaze` is `sentient-glaze` — while the DM,
   * which has emitted `shadow-roach-1` for years, writes `sentient-glaze-1` regardless. Every
   * tier above misses it: it is not an alias, and `sentient-glaze-1-` prefixes nothing.
   *
   * Production 2026-08-10: the slug fell through unresolved, reached `combat_participants.id`,
   * and Postgres refused it as a uuid — a 500 on the first action of the first real fight.
   *
   * Stripping is only ever a *translation*, never a guess. The stripped form must still name
   * exactly one entity, so `shadow-roach-3` against two roaches stays unresolved rather than
   * quietly becoming the first of them, and `wyvern-1` against no wyvern stays unresolved too.
   * A genuinely numbered board never reaches here at all — `shadow-roach-1` is a real alias
   * and matched two tiers up.
   */
  const stripped = wanted.replace(TRAILING_INDEX, '');
  if (stripped === wanted || !stripped) return null;
  const byStrippedIndex = entities.filter((entity) => aliasesFor(entity).includes(stripped));
  return byStrippedIndex.length === 1 ? byStrippedIndex[0] : null;
}

/** The board roster the DM is shown when a reference does not resolve. */
export function describeEntityRoster(
  entities: Array<EntityRef & { x?: number; y?: number }>,
): string {
  return (
    entities
      .map((entity) =>
        entity.x == null || entity.y == null
          ? entitySlug(entity)
          : `${entitySlug(entity)}@${entity.x},${entity.y}`,
      )
      .join(', ') || 'none'
  );
}

export function unknownEntityMessage(
  entities: Array<EntityRef & { x?: number; y?: number }>,
  token: string,
): string {
  return `no entity '${token}'; current entities: ${describeEntityRoster(entities)}`;
}
