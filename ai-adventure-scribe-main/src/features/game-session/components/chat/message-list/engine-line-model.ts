/**
 * The view model of one rules-engine row (#87). Every roll is its own row, written from the
 * player's side.
 *
 * Which side an actor is on comes from producer data, never from the words in the line:
 * - a combat engine block carries `source: 'player' | 'npc'` (`CombatEngineBlock.source`);
 * - otherwise the live encounter roster's `participantType` decides (`player`/`npc` are the
 *   party, every other type is hostile — `isHostileParticipantType`, shared/engine-result-card.ts);
 * - a structured dice roll (`MessageContext.diceRoll`, written by use-message-dice-rolls.ts) is
 *   always the player's own roll.
 * A legacy line with none of these is read as the player's own result, which is what the
 * ordinary-turn path prepends (`⚙️ Engine:` notices for the player's resolved action).
 */
import type { ChatMessage } from '@/types/game';

import { isHostileParticipantType } from '@/services/combat/engine-result-card';

export type EngineLineSide = 'player' | 'npc';

export type EngineLineOutcome =
  | 'hit'
  | 'critical'
  | 'miss'
  | 'enemy-hit'
  | 'enemy-miss'
  | 'pass'
  | 'fail'
  | 'refused'
  | 'saved'
  | 'failed-save'
  | 'move'
  | 'info';

export interface EngineLineModel {
  /** The natural die, or "→" for a move, or "·" when the line carries no die. */
  badge: string;
  side: EngineLineSide;
  /** The kicker after "Rules engine ·", e.g. "your longsword attack". */
  kicker: string;
  /** `{die} + {mod} = {total}`, when the line has the math. */
  math: string | null;
  /** The muted text after the math, or the whole sentence when there is no math. */
  detail: string | null;
  outcome: EngineLineOutcome;
  pill: string;
  /** The engine sentence in player-facing words (names, no enemy HP); the expanded line. */
  sentence: string;
}

/** A row of the live encounter, as `CombatParticipant` carries it. */
export interface EngineRosterRow {
  id: string;
  name: string;
  displayName?: string;
  participantType: string;
  maxHitPoints?: number;
}

export interface EngineLineOptions {
  /** The producer's side for this line (a combat block's `source`). */
  side?: EngineLineSide;
  roster?: readonly EngineRosterRow[];
}

type DiceRollData = NonNullable<NonNullable<ChatMessage['context']>['diceRoll']>;

const ENGINE_PREFIX = /^[ \t]*⚙(?:️)?[ \t]*Engine:\s*/;

/** The issue's slug test: a lowercase id with at least two hyphens. */
const LONG_SLUG = /\b[a-z]+(?:-[a-z0-9]+){2,}\b/g;
/** Any lowercase kebab id; only replaced when the roster knows it. */
const ANY_SLUG = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;

const titleCase = (slug: string): string =>
  slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');

const shownName = (row: EngineRosterRow): string => row.displayName?.trim() || row.name;

const slugOf = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const normalName = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/^the\s+/, '');

function rosterRowFor(
  token: string,
  roster: readonly EngineRosterRow[] = [],
): EngineRosterRow | undefined {
  const wanted = normalName(token);
  const wantedSlug = slugOf(token).replace(/^the-/, '');
  return roster.find(
    (row) =>
      row.id === token ||
      normalName(row.name) === wanted ||
      (row.displayName ? normalName(row.displayName) === wanted : false) ||
      slugOf(row.name).replace(/^the-/, '') === wantedSlug,
  );
}

/** Slugs become names: a roster hit first, then Title Case. No slug survives (#87 item 2). */
export function replaceSlugs(text: string, roster: readonly EngineRosterRow[] = []): string {
  const known = text.replace(ANY_SLUG, (slug) => {
    const row = rosterRowFor(slug, roster);
    return row ? shownName(row) : slug;
  });
  return known.replace(LONG_SLUG, (slug) => titleCase(slug));
}

const isPartyRow = (row: EngineRosterRow | undefined): boolean | undefined =>
  row ? !isHostileParticipantType(row.participantType) : undefined;

const isThePlayer = (name: string, roster: readonly EngineRosterRow[] = []): boolean =>
  /^you$/i.test(name.trim()) || rosterRowFor(name, roster)?.participantType === 'player';

/**
 * "{target} is now at {n} HP" for anyone but the player becomes a tier (#87 item 3): "is down" at
 * 0 HP or below, otherwise "is bloodied" at or under half of the roster's max HP and "is wounded"
 * above it (the tier words of combat-rules-prompts.ts). Without a max HP the tier is "wounded".
 */
export function hideEnemyHp(text: string, roster: readonly EngineRosterRow[] = []): string {
  return text.replace(
    /([A-Z][^.;—]*?) is now at (-?\d+) HP/g,
    (match, target: string, hpText: string) => {
      if (isThePlayer(target, roster)) return match;
      const hp = Number(hpText);
      if (hp <= 0) return `${target} is down`;
      const max = rosterRowFor(target, roster)?.maxHitPoints;
      if (max && Number.isFinite(max) && hp > max / 2) return `${target} is wounded`;
      return max && Number.isFinite(max) ? `${target} is bloodied` : `${target} is wounded`;
    },
  );
}

export function playerFacingSentence(
  line: string,
  roster: readonly EngineRosterRow[] = [],
): string {
  return hideEnemyHp(replaceSlugs(line.replace(ENGINE_PREFIX, '').trim(), roster), roster);
}

/** True when the whole text is a single `⚙️ Engine:` line. */
export function isEngineLine(text: string | null | undefined): boolean {
  const trimmed = (text ?? '').trim();
  return Boolean(trimmed) && !/\n/.test(trimmed) && ENGINE_PREFIX.test(trimmed);
}

const PILL: Record<EngineLineOutcome, string> = {
  hit: 'Hit',
  critical: 'Critical',
  miss: 'Miss',
  'enemy-hit': 'Hit',
  'enemy-miss': 'Miss',
  pass: 'Pass',
  fail: 'Fail',
  refused: 'Refused',
  saved: 'Saved',
  'failed-save': 'Failed save',
  move: 'Move',
  info: 'Note',
};

const signed = (mod: number): string => (mod < 0 ? `− ${Math.abs(mod)}` : `+ ${mod}`);

/** Strip the sentence down to what follows the math, joined with " · ". */
function afterMath(rest: string): string | null {
  const parts = rest
    .replace(/^[\s.—-]+/, '')
    .split(/\s+—\s+|\.\s+/)
    .map((part) => part.replace(/\.$/, '').trim())
    .filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function parseEngineLine(line: string, options: EngineLineOptions = {}): EngineLineModel {
  const roster = options.roster ?? [];
  const sentence = playerFacingSentence(line, roster);

  const actorMatch = sentence.match(/^(.+?)(?:'s spell| rolled | cast | casts | moved | used )/);
  const actor = actorMatch?.[1]?.trim() ?? '';
  const side: EngineLineSide =
    options.side ??
    (isPartyRow(actor ? rosterRowFor(actor, roster) : undefined) === false ? 'npc' : 'player');
  const enemy = side === 'npc';
  const base = { side, sentence };

  const refused = sentence.match(/^.+?'s spell "(.+?)" was refused/);
  if (refused) {
    return {
      ...base,
      badge: '·',
      kicker: refused[1],
      math: null,
      detail: sentence,
      outcome: 'refused',
      pill: PILL.refused,
    };
  }

  if (
    /; no attack was rolled\.$| moved to \(| fled from combat\.| withdrew from combat\./.test(
      sentence,
    )
  ) {
    return {
      ...base,
      badge: '→',
      kicker: 'move',
      math: null,
      detail: sentence,
      outcome: 'move',
      pill: PILL.move,
    };
  }

  // Weapon attack: "{actor} rolled 14 + 5 = 19 vs AC 12 against {target} with {weapon} — HIT. …"
  const attack = sentence.match(
    /^(.+?) rolled (?:\d+ and \d+ \((?:advantage|disadvantage), kept (\d+)\)|(\d+)) ([+-])\s?(\d+) = (-?\d+)(.*)$/,
  );
  if (attack) {
    const die = attack[2] ?? attack[3];
    const mod = Number(`${attack[4]}${attack[5]}`);
    const rest = attack[7];
    const target = rest.match(/ against (.+?)(?: with | — )/)?.[1]?.trim() ?? '';
    const weapon = rest.match(/ with (.+?) — /)?.[1]?.trim() ?? '';
    const word = rest.match(/ — (CRITICAL HIT|AUTO-HIT|HIT|MISS)/)?.[1] ?? '';
    const hit = word !== 'MISS' && word !== '';
    const outcome: EngineLineOutcome = enemy
      ? hit
        ? 'enemy-hit'
        : 'enemy-miss'
      : word === 'CRITICAL HIT'
        ? 'critical'
        : hit
          ? 'hit'
          : 'miss';
    const kicker = enemy
      ? `${actor} attacks ${!target || isThePlayer(target, roster) ? 'you' : target}`
      : `your ${weapon ? `${weapon} ` : ''}attack`;
    const detail = afterMath(
      rest
        .replace(/ against .+? (?=with |— )/, ' ')
        .replace(/with .+? (?=— )/, '')
        .replace(/ — (CRITICAL HIT[^.]*|AUTO-HIT|HIT|MISS)(?: \(auto-rolled\))?\./, '.'),
    );
    return {
      ...base,
      badge: die,
      kicker,
      math: `${die} ${signed(mod)} = ${attack[6]}`,
      detail,
      outcome,
      pill: PILL[outcome],
    };
  }

  // Spell: "{actor} cast {spell} at {target} — DEX save 9 vs DC 13 — PASS. …" and the spell attack.
  const spell = sentence.match(/^(.+?) casts? (.+?)(?: at (.+?))?(?:\.| — )(.*)$/);
  if (spell) {
    const name = spell[2].trim();
    const rest = spell[4] ?? '';
    const save = rest.match(/^(\w+) save (\d+) vs DC (\d+) — (PASS|FAIL)\.?(.*)$/);
    if (save) {
      // The caster's side decides who "saved": your target saving is muted, your own save passing is gold.
      const passed = save[4] === 'PASS';
      const outcome: EngineLineOutcome = enemy
        ? passed
          ? 'pass'
          : 'fail'
        : passed
          ? 'saved'
          : 'failed-save';
      return {
        ...base,
        badge: save[2],
        kicker: name,
        math: `${save[1]} save ${save[2]}`,
        detail: afterMath(`vs DC ${save[3]}. ${save[5]}`),
        outcome,
        pill: PILL[outcome],
      };
    }
    const spellAttack = rest.match(/^spell attack (\d+) ([+-])\s?(\d+) = (-?\d+)(.*)$/);
    const word = rest.match(/(CRITICAL HIT|AUTO-HIT|HIT|MISS|HEALS)/)?.[1] ?? '';
    const hit = word === 'HIT' || word === 'AUTO-HIT' || word === 'CRITICAL HIT';
    const outcome: EngineLineOutcome =
      word === 'HEALS' || word === ''
        ? 'info'
        : enemy
          ? hit
            ? 'enemy-hit'
            : 'enemy-miss'
          : word === 'CRITICAL HIT'
            ? 'critical'
            : hit
              ? 'hit'
              : 'miss';
    return {
      ...base,
      badge: spellAttack?.[1] ?? '·',
      kicker: enemy ? `${actor} casts ${name}` : name,
      math: spellAttack
        ? `${spellAttack[1]} ${signed(Number(`${spellAttack[2]}${spellAttack[3]}`))} = ${spellAttack[4]}`
        : null,
      detail: afterMath(
        (spellAttack ? spellAttack[5] : rest).replace(
          / ?— ?(CRITICAL HIT[^.]*|AUTO-HIT|HIT|MISS)\.?/,
          '.',
        ),
      ),
      outcome,
      pill: word === 'HEALS' ? 'Heals' : PILL[outcome],
    };
  }

  const initiative = /\binitiative\b/i.test(sentence);
  return {
    ...base,
    badge: '·',
    kicker: initiative ? 'initiative' : '',
    math: null,
    detail: sentence,
    outcome: 'info',
    pill: PILL.info,
  };
}

/**
 * A settled dice roll as `use-message-dice-rolls.ts` persists it in `context.diceRoll`, so a
 * reload renders the same row (#87 item 5). It is always the player's own roll.
 */
export function engineLineFromDiceRoll(roll: DiceRollData): EngineLineModel {
  const face =
    roll.naturalRoll ??
    (roll.keptResults?.[0] !== undefined ? roll.keptResults[0] : roll.results?.[0]);
  const die = face !== undefined && Number.isFinite(face) ? face : roll.total - roll.modifier;
  const isAttack = roll.requestType === 'attack';
  const label = (roll.description || roll.label || roll.requestType || 'roll').trim();
  const target =
    isAttack && roll.ac !== undefined
      ? `vs AC ${roll.ac}`
      : roll.dc !== undefined
        ? `vs DC ${roll.dc}`
        : null;
  const outcome: EngineLineOutcome =
    roll.success === undefined
      ? 'info'
      : isAttack
        ? roll.success
          ? 'hit'
          : 'miss'
        : roll.success
          ? 'pass'
          : 'fail';
  const math = `${die} ${signed(roll.modifier)} = ${roll.total}`;
  return {
    badge: String(die),
    side: 'player',
    kicker: isAttack ? 'your attack' : label,
    math,
    detail: target,
    outcome,
    pill: outcome === 'info' ? 'Rolled' : PILL[outcome],
    sentence: `${label}: ${math}${target ? ` ${target}` : ''}${outcome === 'info' ? '' : ` — ${PILL[outcome]}`}.`,
  };
}
