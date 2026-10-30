import { MEMORY_CATEGORIES } from './memoryConstants';

import type { Memory } from './types';
import type { ReactNode } from 'react';

export type ImportanceLevel = { pips: 1 | 2 | 3; label: 'Minor' | 'Notable' | 'Important' };

/** The DB stores importance on a 1-10 scale (db/schema/world.ts). Map it to three pips. */
export const importanceLevel = (importance: number): ImportanceLevel => {
  if (importance >= 8) return { pips: 3, label: 'Important' };
  if (importance >= 4) return { pips: 2, label: 'Notable' };
  return { pips: 1, label: 'Minor' };
};

/** "just now", "5 min ago", "3 hours ago", "3 days ago", then a date. */
export const formatWhen = (createdAt: string, now: number = Date.now()): string => {
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return new Date(createdAt).toLocaleDateString();
};

export interface MemoryGroup {
  key: string;
  label: string;
  icon: ReactNode;
  items: Memory[];
}

/** Groups in the MEMORY_CATEGORIES order; types with no chip go to one "Other" group. */
export const groupMemoriesByCategory = (memories: Memory[]): MemoryGroup[] => {
  const groups: MemoryGroup[] = [];
  for (const category of MEMORY_CATEGORIES) {
    const items = memories.filter((m) => m.type === category.type);
    if (items.length > 0) {
      groups.push({ key: category.type, label: category.label, icon: category.icon, items });
    }
  }
  const knownTypes = new Set(MEMORY_CATEGORIES.map((c) => c.type));
  const other = memories.filter((m) => !knownTypes.has(m.type));
  if (other.length > 0) {
    groups.push({ key: 'other', label: 'Other', icon: null, items: other });
  }
  return groups;
};
