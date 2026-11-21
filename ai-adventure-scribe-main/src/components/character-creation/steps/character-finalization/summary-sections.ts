import type { Character } from '@/types/character';
import type { OptionSelection } from '@/types/enhancement-options';

import { CHARACTER_ENHANCEMENTS } from '@/types/enhancement-options';
import { getSpellById } from '@/utils/spell-lookup';

export interface SpellSummary {
  cantrips: string[];
  spells: string[];
}

export interface SummaryRow {
  label: string;
  value: string;
}

function mapSpellEntries(entries: string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries ?? []) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      continue;
    }
    const trimmed = entry.trim();
    const name = getSpellById(trimmed, false)?.name ?? trimmed;
    if (name.trim() === '') {
      continue;
    }
    if (seen.has(name)) {
      continue;
    }
    seen.add(name);
    result.push(name);
  }
  return result;
}

export function summarizeSpells(character: Partial<Character> | null | undefined): SpellSummary {
  const cantripsRaw = character?.cantrips ?? [];
  const spellsRaw = [...(character?.knownSpells ?? []), ...(character?.preparedSpells ?? [])];

  // Dedupe raw spell ids/names before mapping for the combined list.
  const dedupedSpellsRaw: string[] = [];
  const seenRaw = new Set<string>();
  for (const entry of spellsRaw) {
    if (typeof entry !== 'string' || entry.trim() === '') {
      continue;
    }
    const trimmed = entry.trim();
    if (seenRaw.has(trimmed)) {
      continue;
    }
    seenRaw.add(trimmed);
    dedupedSpellsRaw.push(trimmed);
  }

  return {
    cantrips: mapSpellEntries(cantripsRaw),
    spells: mapSpellEntries(dedupedSpellsRaw),
  };
}

function isNonEmptyValue(value: unknown): boolean {
  if (typeof value === 'string') {
    return value.trim() !== '';
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === 'number') {
    return true;
  }
  return false;
}

export function summarizeEnhancements(
  character: Partial<Character> | null | undefined,
): SummaryRow[] {
  const selections = (character?.enhancementSelections ?? []) as OptionSelection[];
  const rows: SummaryRow[] = [];
  for (const selection of selections) {
    if (!selection) {
      continue;
    }
    const hasCustomValue =
      typeof selection.customValue === 'string' && selection.customValue.trim() !== '';
    if (!hasCustomValue && !isNonEmptyValue(selection.value)) {
      continue;
    }
    const option = CHARACTER_ENHANCEMENTS.find((o) => o.id === selection.optionId);
    const label = option?.name ?? selection.optionId;
    let value = '';
    if (typeof selection.customValue === 'string' && selection.customValue.trim() !== '') {
      value = selection.customValue.trim();
    } else if (Array.isArray(selection.value)) {
      value = selection.value.map((v) => String(v)).join(', ');
    } else {
      value = String(selection.value);
    }
    if (value.trim() === '') {
      continue;
    }
    rows.push({ label, value });
  }
  return rows;
}

function capitalise(value: string): string {
  if (value.length === 0) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function summarizePhysicalTraits(
  character: Partial<Character> | null | undefined,
): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const gender = character?.gender;
  if (typeof gender === 'string' && gender.trim() !== '') {
    rows.push({ label: 'Gender', value: capitalise(gender.trim()) });
  }
  const age = character?.age;
  if (typeof age === 'number' && Number.isFinite(age) && age > 0) {
    rows.push({ label: 'Age', value: age === 1 ? '1 year' : `${age} years` });
  }
  const height = character?.height;
  if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
    const feet = Math.floor(height / 12);
    const remainingInches = height % 12;
    rows.push({ label: 'Height', value: `${feet}'${remainingInches}"` });
  }
  const weight = character?.weight;
  if (typeof weight === 'number' && Number.isFinite(weight) && weight > 0) {
    rows.push({ label: 'Weight', value: `${weight} lbs` });
  }
  const eyes = character?.eyes;
  if (typeof eyes === 'string' && eyes.trim() !== '') {
    rows.push({ label: 'Eyes', value: eyes.trim() });
  }
  const skin = character?.skin;
  if (typeof skin === 'string' && skin.trim() !== '') {
    rows.push({ label: 'Skin', value: skin.trim() });
  }
  const hair = character?.hair;
  if (typeof hair === 'string' && hair.trim() !== '') {
    rows.push({ label: 'Hair', value: hair.trim() });
  }
  return rows;
}
