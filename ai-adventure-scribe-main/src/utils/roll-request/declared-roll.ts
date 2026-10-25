import type { Character } from '@/types/character';

import {
  SKILL_ABILITIES,
  SKILL_ALIASES,
  TOOL_ABILITIES,
  isSkillProficient,
  isToolProficient,
  type AbilityName,
} from '@/utils/character/basic-modifiers';
import { canonicalProficiencyKey } from '@/utils/character/parse-proficiency-list';

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
