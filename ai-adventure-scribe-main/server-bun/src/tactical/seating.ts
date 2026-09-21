import { canOccupy, findPath, getDistance } from './engine.js';
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

export const UNKNOWN_CREATURE = 'Unknown creature';

const GENERIC_NPC_NAMES = new Set([
  'creature',
  'enemy',
  'hostile creature',
  'monster',
  'npc',
  'player',
  'unknown creature',
]);

/** Model-generated seat labels are not NPC identities. */
export function isUnresolvedNpcName(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
  return (
    !normalized ||
    GENERIC_NPC_NAMES.has(normalized) ||
    /^(?:player|npc|enemy|monster|creature|hostile creature|unknown creature)(?:\s+\d+)+$/.test(
      normalized,
    )
  );
}

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

function nameFromSceneDescription(description: string): string | undefined {
  // Scene headings and phrases such as "The Chiropteran Hulk" are the stable names the
  // prose-declaration path still has when the structured combatant was emitted as Player 1.
  const heading = description.match(
    /(?:^|\n)\s*(?:#+\s*)?(?:the\s+)?((?:[A-Z][A-Za-z'’-]*\s+){1,5}[A-Z][A-Za-z'’-]*)(?:\s*\([^\n)]*\))?\s*(?:$|\n)/m,
  );
  if (heading?.[1]) return withoutLeadingArticle(heading[1]);

  const named = description.match(
    /\b(?:called|named|known\s+as)\s+(?:the\s+)?((?:[A-Z][A-Za-z'’-]*\s+){0,4}[A-Z][A-Za-z'’-]*)\b/,
  );
  if (named?.[1]) return withoutLeadingArticle(named[1]);

  const articleName = description.match(
    /\bthe\s+((?:[A-Z][A-Za-z'’-]*\s+){1,4}[A-Z][A-Za-z'’-]*)\b/,
  );
  if (articleName?.[1]) return withoutLeadingArticle(articleName[1]);

  const creatureType = description.match(
    /\b(?:a|an|the)\s+((?:[A-Za-z][A-Za-z'-]*\s+){0,3}(?:hulk|creature|monster|beast|golem|dragon|ogre|troll|giant|guard|captain|soldier|ranger|mage|professor|scholar))\b/i,
  );
  return creatureType?.[1] ? titleizeCreatureType(creatureType[1]) : undefined;
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
}): SceneCombatantResolution {
  const candidate = params.candidateName?.trim();
  const inputNameIsResolved = Boolean(candidate && !isUnresolvedNpcName(candidate));

  const sceneName =
    params.sceneEntityName?.trim() && !isUnresolvedNpcName(params.sceneEntityName)
      ? withoutLeadingArticle(params.sceneEntityName)
      : params.sceneDescription?.trim()
        ? nameFromSceneDescription(params.sceneDescription)
        : undefined;
  const fallback =
    params.fallbackName?.trim() && !isUnresolvedNpcName(params.fallbackName)
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
