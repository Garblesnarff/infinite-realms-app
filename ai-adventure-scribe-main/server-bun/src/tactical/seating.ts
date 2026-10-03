import { canOccupy, findPath, getDistance } from './engine.js';
import { isUnresolvedNpcName, UNKNOWN_CREATURE } from '../../../shared/unresolved-creature-name';
import { findCatalogWeapon } from '../services/combat/weapon-catalog.js';

import type { MapEntity, TacticalMap } from './types.js';
import type {
  MonsterAttack,
  MonsterAttackProfile,
} from '../services/combat/monster-attack-profile.js';
import type { DamageType } from '../types/combat.js';

export type CombatSeatingReason = 'conversation' | 'asset_tag';

export interface CombatSeatingHint {
  targetId: string;
  targetLabel: string;
  reason: CombatSeatingReason;
}

export { UNKNOWN_CREATURE, isUnresolvedNpcName };

function withoutLeadingArticle(value: string): string {
  return value
    .trim()
    .replace(/^["'([{]+|["')\]}.,!?;:]+$/g, '')
    .replace(/^the\s+/i, '')
    .trim();
}

function titleizeCreatureType(value: string): string {
  return withoutLeadingArticle(value)
    .split(/\s+/)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(' ');
}

/**
 * A name a player character already answers to: the same words once the article, case and
 * punctuation are set aside, with or without a trailing count on the candidate ("Apprentice 2").
 * Prose and slugs drop the article ("The Apprentice" -> "Apprentice"), so exact equality alone
 * would miss the very name that reached the board in run M10 (#2438). The count is stripped from
 * the candidate only: a PC called "Agent 7" is not "Agent 8".
 */
function comparableName(value: string): string {
  return withoutLeadingArticle(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** True when `value` equals, or is the article-less / numbered form of, a PC's name. */
export function isPlayerCharacterName(
  value: string | null | undefined,
  playerNames: readonly (string | null | undefined)[] = [],
): boolean {
  const name = value ? comparableName(value) : '';
  if (!name) return false;
  const withoutCount = name.replace(/\s+\d+$/, '');
  return playerNames.some((player) => {
    const playerName = player ? comparableName(player) : '';
    return Boolean(playerName) && (playerName === name || playerName === withoutCount);
  });
}

/**
 * Seat names with every collided seat made unique among all seats. `collided[i]` marks a seat
 * whose name was taken from the scene because it collided with a player's (#2438). A collided
 * seat whose name another seat also holds is numbered ("Mercenary 1", "Mercenary 2"); a seat
 * that did not collide keeps its name.
 */
export function uniqueCollidedSeatNames(
  names: readonly string[],
  collided: readonly boolean[],
): string[] {
  const result = [...names];
  const used = new Set(names.filter((_, i) => !collided[i]).map(comparableName));
  const groups = new Map<string, number[]>();
  names.forEach((name, i) => {
    if (collided[i])
      groups.set(comparableName(name), [...(groups.get(comparableName(name)) ?? []), i]);
  });
  for (const [key, seats] of groups) {
    if (seats.length === 1 && !used.has(key)) {
      used.add(key);
      continue;
    }
    let count = 0;
    for (const i of seats) {
      let candidate: string;
      do {
        count += 1;
        candidate = `${names[i]} ${count}`;
      } while (used.has(comparableName(candidate)));
      used.add(comparableName(candidate));
      result[i] = candidate;
    }
  }
  return result;
}

/** The first match whose name is not a player's: a PC named in the prose must not hide the creature after it. */
function firstNameMatch(
  description: string,
  pattern: RegExp,
  pick: (match: RegExpMatchArray) => string | undefined,
  isPlayer: (name: string) => boolean,
): string | undefined {
  for (const match of description.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
    const name = pick(match);
    if (name && !isPlayer(name)) return name;
  }
  return undefined;
}

/** Nouns that name a kind of creature, so a bare "the dragon" is a creature. */
const CREATURE_KIND_NOUNS = [
  'hulk',
  'creature',
  'monster',
  'beast',
  'golem',
  'dragon',
  'ogre',
  'troll',
];

/**
 * Nouns that name a role or a size as readily as a creature: "the guard rail", "a giant crack",
 * "the captain folds her arms". Alone they say nothing about who is hostile; with a modifier
 * ("a chitinous hunter") they describe one.
 */
export const ROLE_NOUNS: ReadonlySet<string> = new Set([
  'giant',
  'guard',
  'captain',
  'soldier',
  'mercenary',
  'ranger',
  'hunter',
  'mage',
  'professor',
  'scholar',
]);

const CREATURE_BY_KIND = new RegExp(
  `\\b(?:a|an|the)\\s+((?:[A-Za-z][A-Za-z'-]*\\s+){0,3}(?:${[...CREATURE_KIND_NOUNS, ...ROLE_NOUNS].join('|')}))\\b`,
  'i',
);

/**
 * The creature a piece of prose describes by kind ("a chitinous hunter"): the article, up to three
 * words and a creature noun. Unlike the other readers it never takes a capitalised phrase for a
 * name, so scenery ("the Iron Door") and places are not mistaken for a creature.
 */
export function creatureNameFromProse(
  description: string,
  isPlayer: (name: string) => boolean = () => false,
): string | undefined {
  return firstNameMatch(
    description,
    CREATURE_BY_KIND,
    (match) => (match[1] ? titleizeCreatureType(match[1]) : undefined),
    isPlayer,
  );
}

function nameFromSceneDescription(
  description: string,
  isPlayer: (name: string) => boolean = () => false,
): string | undefined {
  const article = (match: RegExpMatchArray): string | undefined =>
    match[1] ? withoutLeadingArticle(match[1]) : undefined;
  // Scene headings and phrases such as "The Chiropteran Hulk" are the stable names the
  // prose-declaration path still has when the structured combatant was emitted as Player 1.
  const heading = firstNameMatch(
    description,
    /(?:^|\n)\s*(?:#+\s*)?(?:the\s+)?((?:[A-Z][A-Za-z'’-]*\s+){1,5}[A-Z][A-Za-z'’-]*)(?:\s*\([^\n)]*\))?\s*(?:$|\n)/m,
    article,
    isPlayer,
  );
  if (heading) return heading;

  const named = firstNameMatch(
    description,
    /\b(?:called|named|known\s+as)\s+(?:the\s+)?((?:[A-Z][A-Za-z'’-]*\s+){0,4}[A-Z][A-Za-z'’-]*)\b/,
    article,
    isPlayer,
  );
  if (named) return named;

  const articleName = firstNameMatch(
    description,
    /\bthe\s+((?:[A-Z][A-Za-z'’-]*\s+){1,4}[A-Z][A-Za-z'’-]*)\b/,
    article,
    isPlayer,
  );
  if (articleName) return articleName;

  return creatureNameFromProse(description, isPlayer);
}

export interface SceneCombatantResolution {
  name: string;
  source: 'input' | 'scene' | 'fallback';
  attackProfile?: MonsterAttackProfile;
  attackSource?: 'scene' | 'role';
}

const sceneWeaponAliases: Array<{ pattern: RegExp; catalogName: string }> = [
  { pattern: /\blongbow\b/i, catalogName: 'longbow' },
  { pattern: /\bshortbow\b/i, catalogName: 'shortbow' },
  { pattern: /\bcrossbow\b/i, catalogName: 'crossbow' },
  { pattern: /\b(?:longsword|sword|blade)\b/i, catalogName: 'longsword' },
  { pattern: /\bshortsword\b/i, catalogName: 'shortsword' },
  { pattern: /\b(?:quarterstaff|staff)\b/i, catalogName: 'quarterstaff' },
  { pattern: /\b(?:dagger|knife)\b/i, catalogName: 'dagger' },
  { pattern: /\b(?:battleaxe|axe)\b/i, catalogName: 'battleaxe' },
  { pattern: /\b(?:mace|hammer|warhammer|maul)\b/i, catalogName: 'mace' },
  { pattern: /\b(?:spear|javelin)\b/i, catalogName: 'spear' },
  { pattern: /\b(?:glaive|halberd|pike)\b/i, catalogName: 'glaive' },
  { pattern: /\bclub\b/i, catalogName: 'club' },
];

const naturalAttackAliases: Array<{
  pattern: RegExp;
  name: string;
  damageDice: string;
  damageType: DamageType;
}> = [
  { pattern: /\bclaws?\b/i, name: 'Claws', damageDice: '1d6', damageType: 'slashing' },
  { pattern: /\b(?:fangs?|bite)\b/i, name: 'Bite', damageDice: '1d6', damageType: 'piercing' },
  { pattern: /\btalons?\b/i, name: 'Talons', damageDice: '1d6', damageType: 'slashing' },
  { pattern: /\bstinger\b/i, name: 'Stinger', damageDice: '1d6', damageType: 'piercing' },
  { pattern: /\bslam\b/i, name: 'Slam', damageDice: '1d6', damageType: 'bludgeoning' },
];

function attackProfileForWeapon(
  name: string,
  source: 'scene' | 'role' = 'scene',
): MonsterAttackProfile | undefined {
  const catalog = findCatalogWeapon(name);
  if (!catalog) return undefined;
  const normalRange = Number(catalog.range?.normal ?? 5);
  const attack: MonsterAttack = {
    name: catalog.name,
    attackBonus: 0,
    damageDice: catalog.damage?.dice ?? '1d6',
    damageBonus: 0,
    damageType: (catalog.damage?.type ?? 'bludgeoning') as DamageType,
    normalRange,
    ...(catalog.range?.long ? { longRange: catalog.range.long } : {}),
    ranged: normalRange > 5,
  };
  return { source, attacks: [attack] };
}

function attackProfileForScene(
  description: string,
  resolvedName: string,
): SceneCombatantResolution['attackProfile'] {
  const namedAttack = description.match(
    /\b([A-Z][A-Za-z'’-]*(?:\s+[A-Z][A-Za-z'’-]*){0,3})\s*:\s*([^!?\n]{0,220})/,
  );
  if (namedAttack?.[1] && !/^(?:hp|ac|speed|abilities|traits?)$/i.test(namedAttack[1])) {
    const details = namedAttack[2] ?? '';
    const dice = details.match(/\b(\d+d\d+)\s*(?:\+\s*(\d+))?/i);
    const damageType = details
      .match(
        /\b(acid|bludgeoning|cold|fire|force|lightning|necrotic|piercing|poison|psychic|radiant|slashing|thunder)\b/i,
      )?.[1]
      ?.toLowerCase() as DamageType | undefined;
    const range = details.match(/\b(?:reach|range|cone)\s+(\d+)\s*ft\b/i);
    const attack: MonsterAttack = {
      name: namedAttack[1].trim(),
      attackBonus: 0,
      damageDice: dice?.[1] ?? '1d6',
      damageBonus: Number(dice?.[2] ?? 0),
      damageType: damageType ?? 'bludgeoning',
      normalRange: Number(range?.[1] ?? 5),
      ranged: false,
    };
    return { source: 'scene', attacks: [attack] };
  }

  const weapon = sceneWeaponAliases.find(({ pattern }) => pattern.test(description));
  if (weapon) return attackProfileForWeapon(weapon.catalogName);

  const natural = naturalAttackAliases.find(({ pattern }) => pattern.test(description));
  if (natural) {
    return {
      source: 'scene',
      attacks: [{ ...natural, attackBonus: 0, damageBonus: 0, normalRange: 5, ranged: false }],
    };
  }

  const role = /\b(?:captain|guard|soldier)\b/i.test(`${resolvedName} ${description}`)
    ? 'longsword'
    : /\b(?:hunter|ranger)\b/i.test(`${resolvedName} ${description}`)
      ? 'shortbow'
      : /\b(?:mage|professor|scholar)\b/i.test(`${resolvedName} ${description}`)
        ? 'dagger'
        : undefined;
  return role ? attackProfileForWeapon(role, 'role') : undefined;
}

/** Resolve the identity and scene-grounded attack carried by a prose combat entry. */
export function resolveSceneCombatant(params: {
  candidateName?: string | null;
  sceneEntityName?: string | null;
  sceneDescription?: string | null;
  fallbackName?: string | null;
  /** Player characters in the fight: a combatant never takes one of their names (#2438). */
  playerNames?: readonly (string | null | undefined)[];
}): SceneCombatantResolution {
  const isUsable = (value: string | null | undefined): boolean =>
    !isUnresolvedNpcName(value) && !isPlayerCharacterName(value, params.playerNames);
  const candidate = params.candidateName?.trim();
  const inputNameIsResolved = Boolean(candidate && isUsable(candidate));

  const sceneName =
    params.sceneEntityName?.trim() && isUsable(params.sceneEntityName)
      ? withoutLeadingArticle(params.sceneEntityName)
      : params.sceneDescription?.trim()
        ? nameFromSceneDescription(params.sceneDescription, (name) =>
            isPlayerCharacterName(name, params.playerNames),
          )
        : undefined;
  const fallback =
    params.fallbackName?.trim() && isUsable(params.fallbackName)
      ? withoutLeadingArticle(params.fallbackName)
      : undefined;
  const name = inputNameIsResolved
    ? (candidate ?? UNKNOWN_CREATURE)
    : sceneName || fallback || UNKNOWN_CREATURE;
  const attackProfile = params.sceneDescription?.trim()
    ? attackProfileForScene(params.sceneDescription, name)
    : undefined;
  return {
    name,
    source: inputNameIsResolved ? 'input' : sceneName ? 'scene' : 'fallback',
    ...(attackProfile
      ? {
          attackProfile,
          attackSource: attackProfile.source === 'role' ? ('role' as const) : ('scene' as const),
        }
      : {}),
  };
}

/** Place a hinted conversational/scene target in melee range without moving the player. */
export function seatEntityWithinReach(
  map: TacticalMap,
  targetId: string,
  playerId: string,
  reachFeet = 5,
): { distanceFeet: number } | null {
  const player = map.entities.find((entity) => entity.id === playerId);
  const target = map.entities.find((entity) => entity.id === targetId);
  if (!player || !target) return null;

  const candidates: Array<{ x: number; y: number; distanceFeet: number; displacement: number }> =
    [];
  for (let y = 0; y < map.height; y += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const candidate = { ...target, x, y } satisfies MapEntity;
      if (!canOccupy(map, candidate, x, y, target.id)) continue;
      const distanceFeet = getDistance(player, candidate);
      if (distanceFeet > reachFeet) continue;
      candidates.push({
        x,
        y,
        distanceFeet,
        displacement: Math.max(Math.abs(x - target.x), Math.abs(y - target.y)),
      });
    }
  }

  const best = candidates.sort(
    (left, right) =>
      left.distanceFeet - right.distanceFeet || left.displacement - right.displacement,
  )[0];
  if (!best) return null;

  const pathCostFeet = findPath(map, target.id, best.x, best.y)?.costFeet ?? 0;
  target.x = best.x;
  target.y = best.y;
  target.movementRemaining = Math.max(0, target.movementRemaining - pathCostFeet);
  return { distanceFeet: best.distanceFeet };
}
