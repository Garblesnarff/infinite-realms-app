import {
  SKILL_ABILITIES,
  SKILL_ALIASES,
  TOOL_ABILITIES,
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

export function findDeclaredSkill(request: DeclaredRollText): string | undefined {
  const text = `${request.purpose || ''} ${request.formula || ''}`;
  const term = SKILL_TERMS.find((candidate) => containsTerm(text, candidate));
  return term ? SKILL_ALIASES[term] || term : undefined;
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
