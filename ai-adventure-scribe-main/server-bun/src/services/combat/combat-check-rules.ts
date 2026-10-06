/**
 * SRD 5.1 (2014) rules for the four mid-combat checks that had no engine owner (#2420).
 *
 * Pure: no database, no session, no narration. Given two participants' ability scores it
 * answers "what was rolled, against what, and who won" — the caller turns that into engine
 * state. That split is what lets the rules be tested against the rulebook rather than against
 * a fixture, and it keeps the narration wording in one place (the caller) instead of two.
 *
 * The four checks, as the SRD states them:
 *  - Shove (PB 192): the attacker makes an Athletics check against the target's Athletics or
 *    Acrobatics — the TARGET chooses which, so the engine uses whichever is higher. Success
 *    knocks the target prone or pushes it 5 feet (the attacker chooses which).
 *  - Grapple (PB 195): the same Athletics-vs-Athletics-or-Acrobatics contest. Success grapples
 *    the target, whose speed becomes 0.
 *  - Escape a grapple (PB 195): the grappled creature uses its action for an Athletics or
 *    Acrobatics check against the grappler's Athletics. Success ends the Grappled condition.
 *  - Hide is an untrained check (PB 183): Stealth against a Dexterity (WIS) check the searchers
 *    make, so the engine compares it to the highest passive Perception among the hostiles.
 *  - Persuasion/Intimidation are Charisma checks (PB 205-206) against a DC the creature's
 *    disposition sets, defaulting to 15.
 */
import { abilityModifier, proficiencyBonus } from './combat-rules.js';

/** The four checks the engine now owns, plus the two Charisma flavours of the fourth. */
export type CombatCheckKind = 'shove' | 'grapple' | 'escape' | 'hide' | 'persuade' | 'intimidate';

export type CheckAbilityKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

/** What a check needs from one participant: their scores and their level. */
export interface CheckActorProfile {
  scores: Partial<Record<CheckAbilityKey, number>>;
  level: number;
  /**
   * The sheet's `skill_proficiencies`, when the sheet grants the check's skill (#2420). Absent or
   * empty for an NPC, whose stat block prints no skill proficiencies.
   */
  skillProficiencies?: readonly string[];
}

export interface CheckDefinition {
  kind: CombatCheckKind;
  /** The ability the SRD names for this check. */
  ability: CheckAbilityKey;
  /** The skill the engine line names, and the proficiency column it is tested against. */
  skill: string;
  /** How the popup and the engine line name this check. */
  label: string;
  /** True when the target rolls a contest die; false when the check meets a fixed DC. */
  contested: boolean;
}

/** The DC a creature's disposition sets for a social check when the stat block names none. */
export const DEFAULT_PARLEY_DC = 15;

/**
 * Which ability and skill each check uses. A shove and a grapple are the same Athletics check;
 * they differ only in what the engine does with the win.
 */
export const CHECK_DEFINITIONS: Record<CombatCheckKind, CheckDefinition> = {
  shove: { kind: 'shove', ability: 'str', skill: 'Athletics', label: 'Shove', contested: true },
  grapple: {
    kind: 'grapple',
    ability: 'str',
    skill: 'Athletics',
    label: 'Grapple',
    contested: true,
  },
  escape: { kind: 'escape', ability: 'str', skill: 'Athletics', label: 'Escape', contested: true },
  hide: { kind: 'hide', ability: 'dex', skill: 'Stealth', label: 'Hide', contested: false },
  persuade: {
    kind: 'persuade',
    ability: 'cha',
    skill: 'Persuasion',
    label: 'Persuasion',
    contested: false,
  },
  intimidate: {
    kind: 'intimidate',
    ability: 'cha',
    skill: 'Intimidation',
    label: 'Intimidation',
    contested: false,
  },
};

/** What a shove's success does, which the player picks in the confirm (SRD: "either ... or"). */
export type ShoveOutcome = 'prone' | 'push';

/** The number of feet a successful shove pushes a creature (SRD: "up to 5 feet"). */
export const SHOVE_PUSH_FEET = 5;

const scoreOf = (profile: CheckActorProfile, ability: CheckAbilityKey): number => {
  const score = profile.scores[ability];
  return typeof score === 'number' && Number.isFinite(score) ? score : 10;
};

/** d20 plus the ability modifier, plus proficiency when the character has the skill. */
export function checkModifier(
  profile: CheckActorProfile,
  definition: CheckDefinition,
  skillProficient = false,
): number {
  const modifier =
    abilityModifier(scoreOf(profile, definition.ability)) +
    (skillProficient ? proficiencyBonus(profile.level) : 0);
  return modifier;
}

/** A d20 face. Passed in so a caller (or a test) can supply a fixed die. */
export type DieRoller = () => number;

/**
 * Passive Perception (SRD: 10 + WIS modifier). An authored stat block may state one outright,
 * which wins — a monster whose block says "passive Perception 14" is not recomputed from a
 * Wisdom score the block may never have printed.
 */
export function passivePerception(profile: CheckActorProfile, authored?: number | null): number {
  if (typeof authored === 'number' && Number.isFinite(authored)) return authored;
  return 10 + abilityModifier(scoreOf(profile, 'wis'));
}

/**
 * The DC a creature sets against a social check.
 *
 * Bible-driven where the stat block says: an authored `parleyDc` on the creature's stats is
 * the author's number and is used verbatim. Otherwise the disposition decides — a creature
 * already friendly to the player is easier to talk down than one that has to be fought, and an
 * ally is easier still. Anything the author did not classify falls back to
 * {@link DEFAULT_PARLEY_DC}, the same number the SRD's own example use (Intimidation, PB 206).
 */
export function parleyDcFor(
  disposition: string | null | undefined,
  authored?: number | null,
): { dc: number; source: 'authored' | 'disposition' | 'default' } {
  if (typeof authored === 'number' && Number.isFinite(authored)) {
    return { dc: authored, source: 'authored' };
  }
  const normalized = (disposition ?? '').trim().toLowerCase();
  if (!normalized) return { dc: DEFAULT_PARLEY_DC, source: 'default' };
  if (/ally|friend|devoted|loyal|helpful/.test(normalized))
    return { dc: 10, source: 'disposition' };
  if (/neutral|peaceful|willing|indifferent/.test(normalized))
    return { dc: 12, source: 'disposition' };
  if (/hostile|enemy|aggressive|unfriendly|antagonistic|defiant/.test(normalized)) {
    return { dc: 18, source: 'disposition' };
  }
  return { dc: DEFAULT_PARLEY_DC, source: 'default' };
}

/** One side of a resolved check: the die, the modifier, and the total the engine prints. */
export interface CheckRoll {
  d20: number;
  modifier: number;
  total: number;
}

/**
 * A resolved check. `target` is present when the target rolled a contest die (shove, grapple);
 * a check against a fixed DC reports that DC instead.
 */
export interface ResolvedCombatCheck {
  kind: CombatCheckKind;
  definition: CheckDefinition;
  actor: CheckRoll;
  target: CheckRoll | null;
  /** What the actor rolled against: the target's contest total, or a fixed DC. */
  opposedBy: number;
  success: boolean;
  /** The engine line, before the caller's names and the target's reaction are folded in. */
  line: string;
}

/** "Athletics 9" — how the target's contest die is named in the engine line. */
function contestLabel(targetProfile: CheckActorProfile, d20: number, modifier: number): string {
  const athletics = abilityModifier(scoreOf(targetProfile, 'str'));
  const acrobatics = abilityModifier(scoreOf(targetProfile, 'dex'));
  // The target chooses (SRD: " Athletics or Acrobatics check"), so the higher one is the one
  // it picks; that is the number the engine reports.
  const skill = acrobatics > athletics ? 'Acrobatics' : 'Athletics';
  return `${skill} ${d20 + modifier}`;
}

/**
 * Resolve a check that the target answers with a contest die (shove, grapple).
 *
 * The player's own d20 may be supplied — the popup rolled it — or the engine rolls it, which is
 * the headless and timeout path. The target's die is always the engine's: the player never
 * rolls the goblin's defence.
 */
export function resolveContestedCheck(params: {
  kind: 'shove' | 'grapple';
  actorProfile: CheckActorProfile;
  actorSkillProficient?: boolean;
  /** The die the player's popup kept; absent = the engine rolls the player's check too. */
  actorD20?: number;
  targetProfile: CheckActorProfile;
  roll: DieRoller;
}): ResolvedCombatCheck {
  const definition = CHECK_DEFINITIONS[params.kind];
  const actorModifier = checkModifier(params.actorProfile, definition, params.actorSkillProficient);
  const actorD20 = params.actorD20 ?? params.roll();
  const targetProfile = params.targetProfile;
  // The target picks the higher of Athletics and Acrobatics (SRD).
  const targetModifier = Math.max(
    abilityModifier(scoreOf(targetProfile, 'str')),
    abilityModifier(scoreOf(targetProfile, 'dex')),
  );
  const targetD20 = params.roll();
  const actor: CheckRoll = {
    d20: actorD20,
    modifier: actorModifier,
    total: actorD20 + actorModifier,
  };
  const target: CheckRoll = {
    d20: targetD20,
    modifier: targetModifier,
    total: targetD20 + targetModifier,
  };
  const success = actor.total > target.total;
  return {
    kind: params.kind,
    definition,
    actor,
    target,
    opposedBy: target.total,
    success,
    line: `${definition.label}: ${actor.total} (nat ${actorD20}${actorModifier >= 0 ? '+' : ''}${actorModifier}) vs ${contestLabel(targetProfile, targetD20, targetModifier)} — ${success ? 'success' : 'failure'}`,
  };
}

/**
 * Resolve a grappled creature's escape (SRD 5.1, PB 195): its Athletics or Acrobatics, whichever
 * is better, against the grappler's Athletics. The grappler does not get to choose a skill, so
 * only its Strength counts. A tie leaves the grapple in place, as for the other contests.
 */
export function resolveEscapeCheck(params: {
  actorProfile: CheckActorProfile;
  athleticsProficient?: boolean;
  acrobaticsProficient?: boolean;
  /** The die the player's popup kept; absent = the engine rolls it. */
  actorD20?: number;
  grapplerProfile: CheckActorProfile;
  roll: DieRoller;
}): ResolvedCombatCheck {
  const definition = CHECK_DEFINITIONS.escape;
  const bonus = proficiencyBonus(params.actorProfile.level);
  const athletics =
    abilityModifier(scoreOf(params.actorProfile, 'str')) + (params.athleticsProficient ? bonus : 0);
  const acrobatics =
    abilityModifier(scoreOf(params.actorProfile, 'dex')) +
    (params.acrobaticsProficient ? bonus : 0);
  const actorModifier = Math.max(athletics, acrobatics);
  const actorD20 = params.actorD20 ?? params.roll();
  const grapplerModifier = abilityModifier(scoreOf(params.grapplerProfile, 'str'));
  const grapplerD20 = params.roll();
  const actor: CheckRoll = {
    d20: actorD20,
    modifier: actorModifier,
    total: actorD20 + actorModifier,
  };
  const target: CheckRoll = {
    d20: grapplerD20,
    modifier: grapplerModifier,
    total: grapplerD20 + grapplerModifier,
  };
  const success = actor.total > target.total;
  return {
    kind: 'escape',
    definition,
    actor,
    target,
    opposedBy: target.total,
    success,
    line: `${definition.label}: ${actor.total} (nat ${actorD20}${actorModifier >= 0 ? '+' : ''}${actorModifier}) vs Athletics ${target.total} — ${success ? 'success' : 'failure'}`,
  };
}

/**
 * Resolve a check against a fixed DC (hide, persuasion, intimidation).
 *
 * The DC is the highest passive Perception among the searchers for a hide, and the
 * disposition's parley DC for the social checks. No target die is rolled: SRD passive
 * Perception is 10 + WIS modifier, not a d20, and a social check is a straight DC test.
 */
export function resolveDcCheck(params: {
  kind: 'hide' | 'persuade' | 'intimidate';
  actorProfile: CheckActorProfile;
  actorSkillProficient?: boolean;
  actorD20?: number;
  dc: number;
  /** What the DC is, for the engine line: "passive Perception 13" or "DC 15". */
  opposedByLabel: string;
  roll: DieRoller;
}): ResolvedCombatCheck {
  const definition = CHECK_DEFINITIONS[params.kind];
  const actorModifier = checkModifier(params.actorProfile, definition, params.actorSkillProficient);
  const actorD20 = params.actorD20 ?? params.roll();
  const actor: CheckRoll = {
    d20: actorD20,
    modifier: actorModifier,
    total: actorD20 + actorModifier,
  };
  const success = actor.total >= params.dc;
  return {
    kind: params.kind,
    definition,
    actor,
    target: null,
    opposedBy: params.dc,
    success,
    line: `${definition.label}: ${actor.total} (nat ${actorD20}${actorModifier >= 0 ? '+' : ''}${actorModifier}) vs ${params.opposedByLabel} — ${success ? 'success' : 'failure'}`,
  };
}
