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
  /**
   * Names that more than one entity answers to, kept as the full candidate list. Three
   * roaches all answer to "Shadow Roach"; collapsing that to one id here is what let a
   * whole encounter's worth of attacks resolve to an arbitrary roach.
   */
  ambiguousAliases: Map<string, string[]>;
  /** Whose turn it is, from the digest's ACTIVE line; the implied actor of a bare attack. */
  activeId: string | null;
};

const ENTITY_LINE =
  /^(?<id>[^|@\s]+)(?:\|(?<name>[^@]*))?@(?<x>-?\d+),(?<y>-?\d+) mv(?<mv>-?\d+)\/(?<speed>-?\d+) vs\[(?<relations>.*)\]$/;
const RELATION =
  /^(?<id>.+):(?<distance>-?\d+)ft\/(?<los>LoS|noLoS)\/c(?<cover>\d+)\/(?:melee|range)$/;
const ARTICLE = /^(?:the|a|an)[-\s]/;

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
  // Candidates are accumulated per alias and only split into unambiguous/ambiguous at the
  // end, so a shared display name never silently overwrites the entity that claimed it first.
  const candidates = new Map<string, string[]>();
  const claim = (alias: string, id: string): void => {
    const known = candidates.get(alias);
    if (!known) candidates.set(alias, [id]);
    else if (!known.includes(id)) known.push(id);
  };
  let activeId: string | null = null;
  for (const line of digestSection.split('\n')) {
    const active = /^ACTIVE\s+(\S+)$/.exec(line.trim());
    if (active) {
      activeId = active[1];
      continue;
    }
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
    claim(id.toLowerCase(), id);
    if (entity.name) claim(entity.name.toLowerCase(), id);
  }
  // Article-stripped forms last: "seeker" must reach "the-seeker". They are gathered into
  // their own map first so that two entities stripping to the same form make that form
  // ambiguous, rather than the first one to be seen quietly claiming it.
  const stripped = new Map<string, string[]>();
  for (const [alias, ids] of candidates)
    for (const form of [
      alias.replace(ARTICLE, ''),
      normalizeEntityToken(alias).replace(ARTICLE, ''),
    ]) {
      if (!form || form === alias || candidates.has(form)) continue;
      const known = stripped.get(form) ?? [];
      stripped.set(form, [...new Set([...known, ...ids])]);
    }
  for (const [form, ids] of stripped) for (const id of ids) claim(form, id);
  if (!entities.size) return null;
  const aliases = new Map<string, string>();
  const ambiguousAliases = new Map<string, string[]>();
  for (const [alias, ids] of candidates)
    if (ids.length === 1) aliases.set(alias, ids[0]);
    else ambiguousAliases.set(alias, ids);
  return {
    entities,
    aliases,
    ambiguousAliases,
    activeId: activeId && entities.has(activeId) ? activeId : null,
  };
}

/**
 * The digest's leading token is the entity's slug, so digest lookups go through the same
 * resolver as map actions: the DM's hyphen/underscore/case drift resolves identically here.
 */
export function resolveDigestEntity(digest: TacticalDigest, token: string): DigestEntity | null {
  return resolveEntityRef([...digest.entities.values()], token);
}
