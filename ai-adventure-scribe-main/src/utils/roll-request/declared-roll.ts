import type { Character } from '@/types/character';
import type { RollRequest } from '@/types/roll-request';

import {
  SKILL_ABILITIES,
  SKILL_ALIASES,
  TOOL_ABILITIES,
  isSkillProficient,
  isToolProficient,
  type AbilityName,
} from '@/utils/character/basic-modifiers';
import { canonicalProficiencyKey } from '@/utils/character/parse-proficiency-list';
import {
  ROLL_FOR_SKILL_PATTERN,
  ROLL_SKILL_CHECK_PATTERN,
  ROLL_SKILL_SIMPLE_PATTERN,
  SKILL_CHECK_STRICT_PATTERN,
} from '@/utils/roll-request/regex-patterns';

/** The text a DM roll request uses to name a skill or an ability. */
export interface DeclaredRollText {
  purpose?: string;
  formula?: string;
  description?: string;
}

const SKILL_TERMS = Array.from(
  new Set([...Object.keys(SKILL_ABILITIES), ...Object.keys(SKILL_ALIASES)]),
).sort((a, b) => b.length - a.length);

const ABILITY_TERMS: ReadonlyArray<[AbilityName, string[]]> = [
  ['strength', ['strength', 'str']],
  ['dexterity', ['dexterity', 'dex']],
  ['constitution', ['constitution', 'con']],
  ['intelligence', ['intelligence', 'int']],
  ['wisdom', ['wisdom', 'wis']],
  ['charisma', ['charisma', 'cha']],
];

/** A whole word, so "strong" is not Strength and "construct" is not Strength. */
function containsTerm(text: string, term: string): boolean {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^a-z])${escapedTerm}(?:$|[^a-z])`, 'i').test(text);
}

/** The index where a whole-word term starts, or -1 when it is not present. */
function termIndex(text: string, term: string): number {
  const escapedTerm = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = new RegExp(`(?:^|[^a-z])(${escapedTerm})(?=$|[^a-z])`, 'i').exec(text);
  if (!match) return -1;
  return match.index + match[0].length - match[1].length;
}

export function findDeclaredSkill(request: DeclaredRollText): string | undefined {
  const text = `${request.purpose || ''} ${request.formula || ''}`;
  let bestTerm: string | undefined;
  let bestIndex = Infinity;
  for (const candidate of SKILL_TERMS) {
    const index = termIndex(text, candidate);
    if (index === -1) continue;
    if (index < bestIndex) {
      bestTerm = candidate;
      bestIndex = index;
    }
  }
  return bestTerm ? SKILL_ALIASES[bestTerm] || bestTerm : undefined;
}

export function findDeclaredAbility(request: DeclaredRollText): AbilityName | undefined {
  const text = `${request.purpose || ''} ${request.formula || ''}`;
  for (const [ability, terms] of ABILITY_TERMS) {
    if (terms.some((term) => containsTerm(text, term))) return ability;
  }
  return undefined;
}

const TOOL_TERMS = [
  ...Object.keys(TOOL_ABILITIES),
  'gaming set (cards)',
  'gaming set (dice)',
  'gaming set',
].sort((a, b) => b.length - a.length);

/**
 * The tool a roll request names ("Thieves' Tools check"), or undefined.
 * Canonicalised, so "Thieves' Tools", "thieves-tools" and "thieves tools" all match.
 */
export function findDeclaredTool(request: DeclaredRollText): string | undefined {
  const text = canonicalProficiencyKey(`${request.purpose || ''} ${request.formula || ''}`);
  if (!text) return undefined;
  if (/gamingset(?:cards|playingcards)/.test(text)) return 'gaming set (cards)';
  if (/gamingsetdice/.test(text)) return 'gaming set (dice)';
  return TOOL_TERMS.find((tool) => text.includes(canonicalProficiencyKey(tool)));
}

/** A tool mention must not discard an already-proficient skill. */
export function preferredDeclaredCheck(
  request: DeclaredRollText,
  character: Character,
): {
  skillName: string | undefined;
  toolName: string | undefined;
} {
  const skillName = findDeclaredSkill(request);
  const toolName = findDeclaredTool(request);
  if (
    skillName &&
    (isSkillProficient(character, skillName) || !toolName || !isToolProficient(character, toolName))
  ) {
    return { skillName, toolName: undefined };
  }
  return { skillName: undefined, toolName };
}

/**
 * Verb patterns that ask for a skill check ("make an Insight check", "roll a
 * Perception check"). The bare "an <skill> check" form in
 * REQUEST_SKILL_CHECK_PATTERN is deliberately excluded: it also matches recap
 * prose ("you passed an Insight check"), which names no new roll.
 */
const NARRATED_SKILL_PATTERNS = [
  SKILL_CHECK_STRICT_PATTERN,
  ROLL_SKILL_CHECK_PATTERN,
  ROLL_FOR_SKILL_PATTERN,
  ROLL_SKILL_SIMPLE_PATTERN,
];

/** Canonical skill name, the way findDeclaredSkill resolves aliases. */
function canonicalSkillName(raw: string): string {
  const normalized = raw.toLowerCase().replace(/\s+/g, ' ').trim();
  return SKILL_ALIASES[normalized] || normalized;
}

/**
 * The single skill a narration explicitly asks for, or undefined when it asks
 * for none or for several. #1086 (c): the roll request's skill must be the one
 * the DM names.
 */
export function narratedSkillCheck(text: string): string | undefined {
  const found = new Set<string>();
  for (const pattern of NARRATED_SKILL_PATTERNS) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      if (match[1]) found.add(canonicalSkillName(match[1]));
    }
  }
  return found.size === 1 ? [...found][0] : undefined;
}

/** "sleight of hand" -> "Sleight Of Hand", the text parser's title-casing. */
function titleCaseSkill(skill: string): string {
  return skill
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The skill term as written in a purpose, at its word boundary, if any.
 * Same earliest-index / longest-tiebreak order as findDeclaredSkill, but
 * purpose-only: a skill token that appears only in the formula (e.g. an
 * ability-only "Wisdom check" whose formula mentions a skill) must not make
 * the request rewritable.
 */
function purposeSkillTerm(
  purpose: string,
): { term: string; index: number; length: number } | undefined {
  let best: { term: string; index: number; length: number } | undefined;
  let bestIndex = Infinity;
  for (const candidate of SKILL_TERMS) {
    const escapedTerm = candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const match = new RegExp(`(?:^|[^a-z])(${escapedTerm})(?=$|[^a-z])`, 'i').exec(purpose);
    if (!match) continue;
    const index = match.index + match[0].length - match[1].length;
    if (index < bestIndex) {
      best = { term: candidate, index, length: match[1].length };
      bestIndex = index;
    }
  }
  return best;
}

/**
 * #1086 (c): when the narration asks for exactly one skill check and the
 * single structured skill request names another skill, the request takes the
 * narrated skill (only the declared skill term inside the purpose is
 * replaced, so trailing context and any tool mention survive;
 * dc/formula/advantage preserved). Anything ambiguous — no ask, several
 * asks, several skill requests, an ability-only request, a skill declared
 * only via the formula — is returned unchanged, as are engine-owned
 * requests (the engine's bonus is the engine's by contract). The corrected
 * purpose is what the dialog shows and what ROLL_PROMPT_SHOWN logs, so the
 * rewrite stays visible.
 */
export function reconcileNarratedSkill(requests: RollRequest[], narration: string): RollRequest[] {
  if (requests.length === 0) return requests;
  const narrated = narratedSkillCheck(narration);
  if (!narrated) return requests;
  const skillRequests = requests.filter(
    (request) =>
      (request.type === 'skill_check' || request.type === 'check') && !request.engineOwned,
  );
  if (skillRequests.length !== 1) return requests;
  const target = skillRequests[0];
  const declared = findDeclaredSkill(target);
  if (!declared || declared === narrated) return requests;
  const term = purposeSkillTerm(target.purpose || '');
  if (!term || (SKILL_ALIASES[term.term] || term.term) !== declared) return requests;
  const purpose = target.purpose || '';
  const rewritten =
    purpose.slice(0, term.index) +
    titleCaseSkill(narrated) +
    purpose.slice(term.index + term.length);
  return requests.map((request) =>
    request === target ? { ...request, purpose: rewritten } : request,
  );
}
