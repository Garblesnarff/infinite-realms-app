/**
 * Merge similarity hits with the live top-by-importance list (#2282).
 * Embedding and match share one budget. A timeout or error returns importance
 * only, and never throws into the turn.
 */

export const RECALL_BUDGET_MS = 300;
/** One user can embed at most this many queries per minute. */
export const RECALL_PER_MINUTE = 30;

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
