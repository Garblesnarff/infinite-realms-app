/**
 * Merge similarity hits with the live top-by-importance list (#2282).
 * Embedding and match share one budget. A timeout or error returns importance
 * only, and never throws into the turn.
 */

export const RECALL_BUDGET_MS = 300;
/** One user can embed at most this many queries per minute. */
const RECALL_PER_MINUTE = 30;

const windows = new Map<string, { count: number; resetAt: number }>();

export function resetRecallRateLimit(): void {
  windows.clear();
}

/** True when this call may embed. Over the cap, the caller must not call the model. */
export function takeRecallSlot(userId: string, now = Date.now()): boolean {
  if (windows.size > 10_000) {
    for (const [key, window] of windows) {
      if (now >= window.resetAt) windows.delete(key);
    }
  }
  const current = windows.get(userId);
  if (!current || now >= current.resetAt) {
    windows.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (current.count >= RECALL_PER_MINUTE) {
    return false;
  }
  current.count += 1;
  return true;
}

/** False once the embed has used up the budget, so match_memories is not started. */
export function shouldRunMatch(startedAt: number, budgetMs: number, now = Date.now()): boolean {
  return now - startedAt < budgetMs;
}

export type RecallRow = { id: string };

/** Half the slots (at least one) are similarity hits. The rest fill from importance. */
export function mergeRecall<T extends RecallRow>(similar: T[], important: T[], limit: number): T[] {
  const cap = Math.max(0, limit);
  const similarSlots = Math.min(cap, Math.max(1, Math.ceil(cap / 2)));
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const row of similar) {
    if (merged.length >= similarSlots) {
      break;
    }
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    merged.push(row);
  }
  for (const row of important) {
    if (merged.length >= cap) {
      break;
    }
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
}

export async function recallWithBudget<T extends RecallRow>(input: {
  limit: number;
  loadImportant: () => Promise<T[]>;
  loadSimilar: () => Promise<T[]>;
  budgetMs?: number;
  logFallback?: (error: unknown) => void;
}): Promise<{ rows: T[]; fellBack: boolean; elapsedMs: number }> {
  const budgetMs = input.budgetMs ?? RECALL_BUDGET_MS;
  const started = Date.now();
  const importantPromise = input.loadImportant();
  let similar: T[] = [];
  let fellBack = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    similar = await Promise.race([
      input.loadSimilar(),
      new Promise<T[]>((_, reject) => {
        timer = setTimeout(() => reject(new Error('memory_recall_budget')), budgetMs);
      }),
    ]);
  } catch (error) {
    fellBack = true;
    input.logFallback?.(error);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
  const important = await importantPromise;
  const elapsedMs = Date.now() - started;
  if (fellBack) {
    return { rows: important.slice(0, input.limit), fellBack, elapsedMs };
  }
  return { rows: mergeRecall(similar, important, input.limit), fellBack, elapsedMs };
}

/**
 * #353: re-rank recalled memories by entity overlap with the query.
 *
 * Embedding similarity can miss a planted fact when the store is crowded
 * (the 64-turn run lost the tile and the quest "who" by turn 63). A memory
 * that shares a rare token with the question — a proper name, a quoted phrase —
 * is almost certainly the one being asked about. Overlap is the primary signal;
 * importance and recency break ties so a high-importance recent memory is not
 * buried under stale ones. This is a stable sort: full ties keep the merge order.
 */
export type RankableRow = RecallRow & {
  content?: string | null;
  /** 1-10 scale (#2283); null when the row did not come from the memories table. */
  importance?: number | null;
  /** ISO string, epoch ms, or Date — whatever the row mapper set. */
  createdAt?: string | number | Date | null;
};

export function rerankByQueryOverlap<T extends RankableRow>(
  rows: T[],
  query: string,
  now: number = Date.now(),
): T[] {
  const tokens = extractQueryTokens(query);
  const scored = rows.map((row, index) => ({
    row,
    index,
    overlap: countTokenOverlap(row.content ?? '', tokens),
    priority: importanceScore(row.importance) + recencyScore(row.createdAt, now),
  }));
  // Overlap first; importance + recency break ties (and order token-less
  // queries entirely). Stable: full ties keep the merge order.
  scored.sort((a, b) => b.overlap - a.overlap || b.priority - a.priority || a.index - b.index);
  return scored.map((s) => s.row);
}

/** Normalize importance to 0..1. Missing importance scores like the old default (3). */
function importanceScore(importance: number | null | undefined): number {
  const value = typeof importance === 'number' && Number.isFinite(importance) ? importance : 3;
  return Math.max(0, Math.min(1, value / 10));
}

/**
 * Recency bonus, 1.0 at `now` decaying to ~0 over 30 days. Memories older than
 * that, or with an unparseable timestamp, get no bonus — but are never penalized.
 */
function recencyScore(createdAt: string | number | Date | null | undefined, now: number): number {
  if (createdAt == null) return 0;
  const ms =
    createdAt instanceof Date
      ? createdAt.getTime()
      : typeof createdAt === 'number'
        ? createdAt
        : Date.parse(createdAt);
  if (!Number.isFinite(ms)) return 0;
  const ageMs = now - ms;
  if (ageMs < 0) return 1; // future timestamp: treat as now, never penalize
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  if (ageMs >= THIRTY_DAYS_MS) return 0;
  return 1 - ageMs / THIRTY_DAYS_MS;
}

/**
 * Significant tokens: quoted phrases, proper nouns, long words.
 *
 * Sentence-initial "What/When/Where" are not proper nouns, and substring
 * matching turned "What" into "somewhat". So the first word is skipped, a
 * stopword list filters interrogatives, and matching is whole-word.
 */
const QUERY_STOPWORDS = new Set([
  'what',
  'when',
  'where',
  'who',
  'whom',
  'whose',
  'why',
  'how',
  'which',
  'that',
  'this',
  'these',
  'those',
  'with',
  'from',
  'have',
  'were',
  'there',
  'their',
  'then',
  'than',
]);

function extractQueryTokens(query: string): string[] {
  const tokens = new Set<string>();
  // Quoted phrases first (the player is naming something exactly). Quoting is
  // deliberate, so these are kept even in sentence-initial position.
  for (const match of query.matchAll(/"([^"]{3,})"/g)) {
    tokens.add(match[1].toLowerCase());
  }
  const words = query.split(/[^A-Za-z'-]+/).filter((word) => word.length > 0);
  words.forEach((rawWord) => {
    const word = rawWord.toLowerCase().replace(/'s$/, ''); // possessive: "Quillon's" -> "quillon"
    if (word.length < 4) return;
    // Stopwords filter sentence-initial "What/When/Where" (and anywhere else);
    // a sentence-initial proper noun ("Quillon, ...") is significant and kept.
    if (QUERY_STOPWORDS.has(word)) return;
    // Proper noun (capitalized) or long content word.
    if (/^[A-Z]/.test(rawWord) || word.length >= 7) {
      tokens.add(word);
    }
  });
  return [...tokens];
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countTokenOverlap(content: string, tokens: string[]): number {
  const lower = content.toLowerCase();
  let count = 0;
  for (const token of tokens) {
    // Whole-word match: "what" must not match "somewhat". Lookarounds (not \b)
    // so quoted phrases with leading/trailing punctuation still match.
    if (new RegExp(`(?<!\\w)${escapeRegExp(token)}(?!\\w)`).test(lower)) count += 1;
  }
  return count;
}
