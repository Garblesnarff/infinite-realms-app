/**
 * Parser for the tactical digest the server injects into the DM prompt.
 *
 * The digest is engine output (`buildTacticalDigest` calls `getDistance`,
 * `checkLineOfSight`, and `getCover`), so reading it back is how validation stays
 * anchored to the exact geometry the model was shown.
 */
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
  if (!entities.size) return null;
  return { entities, aliases };
}

export function resolveDigestEntity(digest: TacticalDigest, token: string): DigestEntity | null {
  const id = digest.aliases.get(token.trim().toLowerCase());
  return id ? (digest.entities.get(id) ?? null) : null;
}

/**
 * Roll requests carry no actor/target fields, so the pair is recovered from the purpose
 * text by matching known ids/names in the order they appear: attacker first, target last.
 */
export function resolvePairFromText(
  digest: TacticalDigest,
  text: string,
): { actor: DigestEntity; target: DigestEntity } | null {
  const haystack = text.toLowerCase();
  const firstMention = new Map<string, number>();
  for (const [alias, id] of digest.aliases) {
    const index = haystack.indexOf(alias);
    if (index < 0) continue;
    const known = firstMention.get(id);
    if (known === undefined || index < known) firstMention.set(id, index);
  }
  const ordered = [...firstMention.entries()].sort((a, b) => a[1] - b[1]);
  if (ordered.length < 2) return null;
  const actor = digest.entities.get(ordered[0][0]);
  const target = digest.entities.get(ordered[ordered.length - 1][0]);
  return actor && target ? { actor, target } : null;
}
