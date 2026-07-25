/**
 * Parser for the tactical digest the server injects into the DM prompt.
 *
 * The digest is engine output (`buildTacticalDigest` calls `getDistance`,
 * `checkLineOfSight`, and `getCover`), so reading it back is how validation stays
 * anchored to the exact geometry the model was shown.
 */
import { normalizeEntityToken, resolveEntityRef } from './identity.js';

export type DigestRelation = {
  id: string;
  distanceFeet: number;
  hasLineOfSight: boolean;
  cover: number;
};

export type DigestEntity = {
  id: string;
  name?: string;
  x: number;
  y: number;
  movementRemaining: number;
  speedFeet: number;
  relations: Map<string, DigestRelation>;
};

export type TacticalDigest = {
  entities: Map<string, DigestEntity>;
  /** Lowercase id/name → id, so prose and structured actions resolve the same way. */
  aliases: Map<string, string>;
};

const ENTITY_LINE =
  /^(?<id>[^|@\s]+)(?:\|(?<name>[^@]*))?@(?<x>-?\d+),(?<y>-?\d+) mv(?<mv>-?\d+)\/(?<speed>-?\d+) vs\[(?<relations>.*)\]$/;
const RELATION =
  /^(?<id>.+):(?<distance>-?\d+)ft\/(?<los>LoS|noLoS)\/c(?<cover>\d+)\/(?:melee|range)$/;
const ARTICLE = /^(?:the|a|an)[-\s]/;

/** Substring match constrained to slug-token boundaries, so "ram" cannot match "program". */
function indexOfToken(haystack: string, needle: string): number {
  if (!needle) return -1;
  for (let from = 0; from <= haystack.length; ) {
    const index = haystack.indexOf(needle, from);
    if (index < 0) return -1;
    const before = index === 0 || haystack[index - 1] === '-';
    const after =
      index + needle.length === haystack.length || haystack[index + needle.length] === '-';
    if (before && after) return index;
    from = index + 1;
  }
  return -1;
}

/**
 * Reads the digest the server itself injected into the prompt. Parsing (rather than
 * re-deriving) keeps validation anchored to the exact geometry the model was shown.
 */
export function parseTacticalDigest(prompt: string): TacticalDigest | null {
  const block = /<tactical_context>([\s\S]*?)<\/tactical_context>/.exec(prompt);
  if (!block) return null;
  const digestSection = block[1].split(/TACTICAL DIGEST\n/)[1];
  if (!digestSection) return null;
  const entities = new Map<string, DigestEntity>();
  const aliases = new Map<string, string>();
  for (const line of digestSection.split('\n')) {
    const match = ENTITY_LINE.exec(line.trim());
    if (!match?.groups) continue;
    const { id, name, x, y, mv, speed, relations } = match.groups;
    const entity: DigestEntity = {
      id,
      name: name?.trim() || undefined,
      x: Number(x),
      y: Number(y),
      movementRemaining: Number(mv),
      speedFeet: Number(speed),
      relations: new Map(),
    };
    for (const raw of relations.split(',')) {
      const relation = RELATION.exec(raw.trim());
      if (!relation?.groups) continue;
      entity.relations.set(relation.groups.id, {
        id: relation.groups.id,
        distanceFeet: Number(relation.groups.distance),
        hasLineOfSight: relation.groups.los === 'LoS',
        cover: Number(relation.groups.cover),
      });
    }
    entities.set(id, entity);
    aliases.set(id.toLowerCase(), id);
    if (entity.name) aliases.set(entity.name.toLowerCase(), id);
  }
  // Article-stripped forms last, and only when unambiguous: "seeker" must reach "the-seeker",
  // but it must not silently steal a mention from a second entity that also strips to it.
  const stripped = new Map<string, string | null>();
  for (const [alias, id] of [...aliases])
    for (const form of [
      alias.replace(ARTICLE, ''),
      normalizeEntityToken(alias).replace(ARTICLE, ''),
    ])
      if (form && form !== alias && !aliases.has(form))
        stripped.set(form, stripped.has(form) && stripped.get(form) !== id ? null : id);
  for (const [alias, id] of stripped) if (id) aliases.set(alias, id);
  if (!entities.size) return null;
  return { entities, aliases };
}

/**
 * The digest's leading token is the entity's slug, so digest lookups go through the same
 * resolver as map actions: the DM's hyphen/underscore/case drift resolves identically here.
 */
export function resolveDigestEntity(digest: TacticalDigest, token: string): DigestEntity | null {
  return resolveEntityRef([...digest.entities.values()], token);
}

/**
 * Roll requests carry no actor/target fields, so the pair is recovered from the purpose
 * text by matching known ids/names in the order they appear: attacker first, target last.
 * Matching runs over a slug-normalized copy of the text, so "Shadow Roach 1",
 * "shadow_roach_1", and "shadow-roach-1" in prose all find the same entity.
 */
export function resolvePairFromText(
  digest: TacticalDigest,
  text: string,
): { actor: DigestEntity; target: DigestEntity } | null {
  const haystack = normalizeEntityToken(text);
  const matches: Array<{ id: string; index: number; length: number }> = [];
  for (const [alias, id] of digest.aliases) {
    const normalized = normalizeEntityToken(alias);
    const index = indexOfToken(haystack, normalized);
    if (index >= 0) matches.push({ id, index, length: normalized.length });
  }
  const firstMention = new Map<string, number>();
  for (const match of matches) {
    // Two roaches share the name "Shadow Roach", so at a given position only the longest
    // alias counts: "shadow-roach-1" must not lose its mention to the shared name.
    const shadowed = matches.some(
      (other) =>
        other.id !== match.id && other.index === match.index && other.length > match.length,
    );
    if (shadowed) continue;
    const known = firstMention.get(match.id);
    if (known === undefined || match.index < known) firstMention.set(match.id, match.index);
  }
  const ordered = [...firstMention.entries()].sort((a, b) => a[1] - b[1]);
  if (ordered.length < 2) return null;
  const actor = digest.entities.get(ordered[0][0]);
  const target = digest.entities.get(ordered[ordered.length - 1][0]);
  return actor && target ? { actor, target } : null;
}
