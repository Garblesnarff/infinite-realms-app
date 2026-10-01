/**
 * The structured side of an engine result card (#2417, design on #2393).
 *
 * Every field is read from the engine result by the transcript producers, never parsed back out
 * of the text line. The line travels with the card as `line`: it is the card's screen reader
 * text and the source the legacy chip still renders for messages saved before cards existed.
 *
 * Colour rule (Rob, 2026-10-01): gold helps you, red hurts you, grey changes nothing. The word and
 * the icon always carry the same meaning as the colour.
 */
import {
  facingName,
  formatVersusArmorClass,
  rosterEntryForParticipant,
  type EngineRosterEntry,
} from '../../../shared/engine-display-name';

import type { CombatEngineResult, EngineOutcomeOptions } from './combat-outcome-transcript';

export type EngineBadgeWord =
  | 'HIT'
  | 'MISS'
  | 'CRITICAL HIT'
  | 'AUTO-HIT'
  | 'HEALS'
  | 'TARGET FAILED'
  | 'TARGET SAVED'
  | 'REFUSED'
  | 'FAILED'
  | 'PASSED';
export type EngineBadgeTone = 'gold' | 'red' | 'grey';
export type EngineBadgeIcon = 'check' | 'alert' | 'dash';

export interface EngineBadge {
  word: EngineBadgeWord;
  tone: EngineBadgeTone;
  icon: EngineBadgeIcon;
}

/** The party is the player and their companions; every other actor is an enemy. */
export type EngineCardSide = 'party' | 'enemy';

export type EngineCardKind =
  | 'attack'
  | 'spell'
  | 'move'
  | 'weapon_swap'
  | 'death_save'
  | 'initiative'
  | 'refused';

export interface EngineCardArmorClass {
  targetAC?: number | null;
  baseAc?: number | null;
  coverBonus?: number | null;
  cover?: number | null;
}

export type EngineCardMath =
  | {
      kind: 'attack';
      d20: number;
      bonus: number;
      total: number;
      ac: EngineCardArmorClass;
      /** The target is the player, so the card says "your AC". */
      targetIsPlayer: boolean;
    }
  | { kind: 'save'; ability: string; roll: number; dc: number };

export interface EngineCardHp {
  name: string;
  newHp: number;
  /** What the hit took (the engine's `finalDamage`). */
  lost: number;
  maxHp?: number;
}

export interface EngineCardInitiativeEntry {
  name: string;
  initiative: number;
  isPlayer: boolean;
}

export interface EngineResultCard {
  kind: EngineCardKind;
  side: EngineCardSide;
  /** The engine line this card stands for. The card's `aria-label`. */
  line: string;
  /** Other printed lines this card stands for (the server's death save lines), so no chip repeats them. */
  covers?: string[];
  title: string;
  badge?: EngineBadge;
  math?: EngineCardMath;
  /** Damage, or "No damage." */
  effect?: string;
  /** The player was hit: name, new HP and the loss. */
  hp?: EngineCardHp;
  /** An enemy's state in the words the engine gave (`Captain Reeves is now at 9 HP`). */
  status?: string;
  /** The one line of a light card (move, weapon swap, death save, initiative). */
  detail?: string;
  /** Death save pips. */
  deathSave?: { successes: number; failures: number };
  initiative?: { order: EngineCardInitiativeEntry[] };
}

export type EngineBadgeOutcome =
  | 'hit'
  | 'critical'
  | 'auto-hit'
  | 'heals'
  | 'target-failed'
  | 'miss'
  | 'target-saved'
  | 'refused'
  | 'death-save-failed'
  | 'death-save-passed';

const BADGE_WORDS: Record<EngineBadgeOutcome, EngineBadgeWord> = {
  hit: 'HIT',
  critical: 'CRITICAL HIT',
  'auto-hit': 'AUTO-HIT',
  heals: 'HEALS',
  'target-failed': 'TARGET FAILED',
  miss: 'MISS',
  'target-saved': 'TARGET SAVED',
  refused: 'REFUSED',
  'death-save-failed': 'FAILED',
  'death-save-passed': 'PASSED',
};

/**
 * An outcome in which the actor got what they came for (a hit, a failed save) is gold when the
 * party acted and red when an enemy did. An outcome that changes nothing is grey. A death save is
 * always the player's own: a pass helps, a failure hurts.
 */
export function engineBadge(outcome: EngineBadgeOutcome, side: EngineCardSide): EngineBadge {
  const word = BADGE_WORDS[outcome];
  if (outcome === 'miss' || outcome === 'target-saved' || outcome === 'refused') {
    return { word, tone: 'grey', icon: 'dash' };
  }
  const helpsYou =
    outcome === 'death-save-passed' || (side === 'party' && outcome !== 'death-save-failed');
  return helpsYou ? { word, tone: 'gold', icon: 'check' } : { word, tone: 'red', icon: 'alert' };
}

/**
 * Whether a participant fights against the player. The client's own mapper types every
 * non-player participant `monster` (`mapAuthoritativeCombat`), whatever the type's union says, so
 * "enemy" is anything that is not the player or a companion.
 */
export function isHostileParticipantType(type: string | null | undefined): boolean {
  return Boolean(type) && type !== 'player' && type !== 'npc';
}

/**
 * Which side an actor is on. A roster row that carries no participant type (an older payload)
 * falls back on the target: an actor who hit the player is hostile.
 */
export function engineCardSide(
  actorId: string | undefined,
  roster: readonly EngineRosterEntry[],
  targetIsPlayer: boolean,
): EngineCardSide {
  const entry = actorId
    ? roster.find((row) => row.id === actorId || row.name === actorId || row.slug === actorId)
    : undefined;
  if (entry?.participantType) {
    return isHostileParticipantType(entry.participantType) ? 'enemy' : 'party';
  }
  return targetIsPlayer ? 'enemy' : 'party';
}

/**
 * `text` with the target's AC and the save DC taken out, for a card whose setting is off. Both
 * phrases are rebuilt from the card's own fields, so the text is never searched for patterns.
 * `text` may be the card's line or any longer text that holds it.
 */
export function hideTargetNumbers(text: string, card: EngineResultCard): string {
  if (!card.math) return text;
  if (card.math.kind === 'attack') {
    return text.replace(formatVersusArmorClass(card.math.ac), 'vs AC ?');
  }
  return text.replace(` vs DC ${card.math.dc}`, '');
}

/** The card's screen reader sentence: the engine line, less the target numbers when they are off. */
export function engineCardAriaLabel(card: EngineResultCard, showTargetNumbers: boolean): string {
  const label = card.line.replace(/^[ \t]*⚙(?:️)?[ \t]*Engine:\s*/, '').trim();
  return showTargetNumbers ? label : hideTargetNumbers(label, card);
}

function armorClassPhrase(math: Extract<EngineCardMath, { kind: 'attack' }>): string {
  const { targetAC: effective, baseAc: base, coverBonus: bonus, cover } = math.ac;
  const owner = math.targetIsPlayer ? 'your ' : '';
  if (effective == null || !Number.isFinite(effective)) return `vs ${owner}AC ?`;
  if (base != null && bonus != null && bonus > 0) {
    const kind = cover === 2 || bonus >= 5 ? 'three-quarters cover' : 'half cover';
    return `vs ${owner}AC ${effective} (${base} + ${bonus} ${kind})`;
  }
  return `vs ${owner}AC ${effective}`;
}

/** The card's math line. Off, the target's AC reads `?` and the save leaves out its DC. */
export function engineCardMathText(math: EngineCardMath, showTargetNumbers: boolean): string {
  if (math.kind === 'save') {
    const base = `${math.ability} save ${math.roll}`;
    return showTargetNumbers ? `${base} vs DC ${math.dc}` : base;
  }
  const modifier = math.bonus < 0 ? `- ${Math.abs(math.bonus)}` : `+ ${math.bonus}`;
  const roll = `d20 ${math.d20} ${modifier} = ${math.total}`;
  return showTargetNumbers
    ? `${roll} ${armorClassPhrase(math)}`
    : `${roll} vs ${math.targetIsPlayer ? 'your ' : ''}AC ?`;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** `3 slashing damage`, or `No damage.` The card's effect line, from the same fields as the line. */
export function damageEffectText(result: CombatEngineResult): string | undefined {
  if (isFiniteNumber(result.finalDamage)) {
    if (result.finalDamage === 0 && result.hit === false) return 'No damage.';
    return `${result.finalDamage}${result.damageType ? ` ${result.damageType}` : ''} damage`;
  }
  if (result.hit === false) return 'No damage.';
  return result.hit === true ? '0 damage' : undefined;
}

/** The card's HP line: a hit on the player, whose own HP is theirs to see (#2378). */
export function playerHpOf(
  result: CombatEngineResult,
  target: string,
  options: EngineOutcomeOptions,
): EngineCardHp | undefined {
  if (!options.targetHp || !isFiniteNumber(result.targetNewHp)) return undefined;
  if (!isFiniteNumber(result.finalDamage) || result.finalDamage <= 0) return undefined;
  return {
    name: target,
    newHp: result.targetNewHp,
    lost: result.finalDamage,
    ...(isFiniteNumber(options.targetMaxHp) ? { maxHp: options.targetMaxHp } : {}),
  };
}

/** A saved card read back from a message's context: anything without these fields is dropped. */
export function isEngineResultCard(value: unknown): value is EngineResultCard {
  if (!value || typeof value !== 'object') return false;
  const card = value as Record<string, unknown>;
  return (
    typeof card.kind === 'string' &&
    (card.side === 'party' || card.side === 'enemy') &&
    typeof card.line === 'string' &&
    typeof card.title === 'string' &&
    (card.math === undefined ||
      (typeof card.math === 'object' &&
        card.math !== null &&
        ((card.math as { kind?: unknown }).kind !== 'attack' ||
          typeof (card.math as { ac?: unknown }).ac === 'object')))
  );
}

/**
 * The seating card: who rolled what, in the order they act. Built from the seated participants the
 * entry response carries, not from the seating line, which is its screen reader text.
 */
export function initiativeCard(
  participants: ReadonlyArray<{
    id?: string;
    name?: string;
    initiative?: number;
    turnOrder?: number;
    participantType?: string;
  }>,
  line: string,
): EngineResultCard | null {
  const seated = participants
    .filter((participant) => isFiniteNumber(participant.initiative))
    .sort((a, b) => (a.turnOrder ?? 0) - (b.turnOrder ?? 0));
  if (!seated.length) return null;
  const roster = seated.map((participant) =>
    rosterEntryForParticipant({
      id: participant.id ?? participant.name ?? '',
      name: participant.name,
    }),
  );
  const order = seated.map((participant) => ({
    name: facingName(undefined, participant.id ?? participant.name, roster),
    initiative: participant.initiative as number,
    isPlayer: participant.participantType === 'player',
  }));
  return {
    kind: 'initiative',
    side: 'party',
    line,
    title: 'Initiative',
    detail: `${order[0].name} acts first.`,
    initiative: { order },
  };
}
