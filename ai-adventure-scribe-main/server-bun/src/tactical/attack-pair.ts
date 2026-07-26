/**
 * Recovering the attacker/target pair from a roll request's purpose text.
 *
 * Roll requests carry no actor or target fields, so the only evidence is prose the model
 * wrote. Run 7 proved that demanding both names in that prose is the same as not checking at
 * all: for thirty turns the purposes named one side, the pair came back null, and the spatial
 * contract never fired. What follows is deliberately read-side pragmatism — infer the missing
 * side, prefer the nearest candidate — while writes elsewhere still refuse ambiguity outright.
 */
import { normalizeEntityToken } from './identity.js';

import type { DigestEntity, TacticalDigest } from './digest-parse.js';

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
 * How a pair was recovered. Anything other than `explicit` means the text did not actually
 * name both sides and the validator filled a side in; callers log it so a board that is being
 * checked against assumptions rather than against the model's own words stays visible.
 */
export type PairFallback = 'assumed_actor' | 'assumed_target' | 'nearest_hostile';

export type ResolvedPair = {
  actor: DigestEntity;
  target: DigestEntity;
  fallbacks: PairFallback[];
};

/** The digest lists only enemies in `vs[...]`, so an entity's relations are its hostiles. */
function nearestHostile(digest: TacticalDigest, entity: DigestEntity): DigestEntity | null {
  let nearest: DigestEntity | null = null;
  let best = Infinity;
  for (const relation of entity.relations.values()) {
    const candidate = digest.entities.get(relation.id);
    if (candidate && relation.distanceFeet < best) {
      best = relation.distanceFeet;
      nearest = candidate;
    }
  }
  return nearest;
}

/** Of several entities answering to one name, the one nearest the entity on the other side. */
function nearestOf(
  digest: TacticalDigest,
  ids: string[],
  from: DigestEntity | null,
): DigestEntity | null {
  const entities = ids.map((id) => digest.entities.get(id)).filter((e): e is DigestEntity => !!e);
  if (entities.length <= 1) return entities[0] ?? null;
  if (!from) return null;
  const distance = (entity: DigestEntity): number =>
    from.relations.get(entity.id)?.distanceFeet ??
    entity.relations.get(from.id)?.distanceFeet ??
    Infinity;
  return entities.reduce((best, entity) => (distance(entity) < distance(best) ? entity : best));
}

export type Mention = { ids: string[]; index: number; length: number };

/**
 * Every entity name the text contains, in order of first appearance.
 *
 * Exported because the prose-intent floor matches narration with exactly this matcher. A
 * second implementation would drift from it, and the whole point of the floor is that prose
 * the spatial contract can already read is prose the engine can already act on.
 */
export function collectEntityMentions(digest: TacticalDigest, text: string): Mention[] {
  const haystack = normalizeEntityToken(text);
  const matches: Mention[] = [];
  const consider = (alias: string, ids: string[]): void => {
    const normalized = normalizeEntityToken(alias);
    const index = indexOfToken(haystack, normalized);
    if (index >= 0) matches.push({ ids, index, length: normalized.length });
  };
  for (const [alias, id] of digest.aliases) consider(alias, [id]);
  for (const [alias, ids] of digest.ambiguousAliases) consider(alias, ids);
  const firstMention = new Map<string, Mention>();
  for (const match of matches) {
    // Two roaches share the name "Shadow Roach", so at a given position only the longest
    // alias counts: "shadow-roach-1" must not lose its mention to the shared name.
    const shadowed = matches.some(
      (other) =>
        other.index === match.index &&
        other.length > match.length &&
        other.ids.join() !== match.ids.join(),
    );
    if (shadowed) continue;
    const slot = match.ids.join();
    const known = firstMention.get(slot);
    if (!known || match.index < known.index) firstMention.set(slot, match);
  }
  return [...firstMention.values()].sort((a, b) => a.index - b.index);
}

/**
 * Roll requests carry no actor/target fields, so the pair is recovered from the purpose text
 * by matching known ids/names in the order they appear: attacker first, target last.
 *
 * Real purposes routinely name only one side — "Attack roll against the Shadow Roach" from a
 * player, "the Shadow Roach lunges at you" from the DM — and demanding two names is what made
 * this return null, and the spatial contract fall silent, for thirty consecutive turns. The
 * missing side is therefore inferred from the digest's ACTIVE line, and a name several
 * entities answer to resolves to the nearest one rather than to nothing. Both are read-side
 * pragmatism: writes still refuse ambiguity outright.
 */
export function resolvePairFromText(digest: TacticalDigest, text: string): ResolvedPair | null {
  const mentions = collectEntityMentions(digest, text);
  const active = digest.activeId ? (digest.entities.get(digest.activeId) ?? null) : null;
  const fallbacks: PairFallback[] = [];

  let actorIds: string[];
  let targetIds: string[];
  if (mentions.length >= 2) {
    actorIds = mentions[0].ids;
    targetIds = mentions[mentions.length - 1].ids;
  } else if (mentions.length === 1 && active) {
    // One name and a known active entity. If the name could be the active entity then it is
    // the attacker naming itself ("the Shadow Roach lunges at you") and the victim is implied;
    // otherwise the name is the victim and the active entity is the attacker ("attack roll
    // against the Shadow Roach", written by a player on their own turn).
    const namesActive = mentions[0].ids.includes(active.id);
    actorIds = [active.id];
    targetIds = namesActive ? [] : mentions[0].ids;
    fallbacks.push(namesActive ? 'assumed_target' : 'assumed_actor');
  } else {
    return null;
  }

  // The unambiguous side is resolved first so it can anchor "nearest" for the other one.
  let actor = actorIds.length === 1 ? (digest.entities.get(actorIds[0]) ?? null) : null;
  let target = targetIds.length === 1 ? (digest.entities.get(targetIds[0]) ?? null) : null;
  if (!actor) {
    actor = nearestOf(digest, actorIds, target);
    if (actor) fallbacks.push('nearest_hostile');
  }
  if (!actor) return null;
  if (!target) {
    // The actor can appear among an ambiguous name's candidates ("the Shadow Roach" while a
    // roach is acting); it is never its own target, so it is excluded before choosing.
    const others = targetIds.filter((id) => id !== actor.id);
    target = others.length ? nearestOf(digest, others, actor) : nearestHostile(digest, actor);
    if (target) fallbacks.push('nearest_hostile');
  }
  if (!target || target.id === actor.id) return null;
  return { actor, target, fallbacks };
}
