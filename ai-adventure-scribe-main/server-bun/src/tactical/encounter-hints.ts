/**
 * Which encounters have already been shown a teaching hint.
 *
 * A corrective that repeats every turn is a tax, not a lesson: run 8 spent eleven of them on
 * one model that was never going to switch dialects. The hint is therefore fired once per
 * encounter and then never again, which is why this module exists — the LLM route is
 * stateless, so "once per encounter" has to be remembered somewhere.
 */

/** Bounded so a long-lived process cannot accumulate one entry per encounter forever. */
const MAX_TRACKED_ENCOUNTERS = 512;

const hinted = new Set<string>();

/**
 * Identifies the encounter this prompt belongs to. The client stamps `encounterId` into the
 * immutable game state; a prompt without one falls back to the digest's roster, which is
 * stable for the life of an encounter and changes when a new one starts.
 */
export function encounterKeyFromPrompt(prompt: string): string | null {
  const state = /<immutable_game_state>([\s\S]*?)<\/immutable_game_state>/.exec(prompt);
  if (state) {
    try {
      const parsed = JSON.parse(state[1]) as { encounterId?: unknown };
      if (typeof parsed.encounterId === 'string' && parsed.encounterId)
        return `encounter:${parsed.encounterId}`;
    } catch {
      // A malformed envelope is not worth failing a turn over; the roster fallback covers it.
    }
  }
  const digest = /<tactical_context>([\s\S]*?)<\/tactical_context>/.exec(prompt);
  if (!digest) return null;
  const section = digest[1].split(/TACTICAL DIGEST\n/)[1];
  if (!section) return null;
  const ids = section
    .split('\n')
    .map((line) => /^([^|@\s]+)[|@]/.exec(line.trim())?.[1])
    .filter((id): id is string => !!id)
    .sort();
  return ids.length ? `roster:${ids.join(',')}` : null;
}

/**
 * True exactly once per encounter. A prompt with no identifiable encounter gets the hint,
 * because a hint too many is cheaper than an attack that silently changes behaviour.
 */
export function claimFirstOffenseHint(key: string | null): boolean {
  if (!key) return true;
  if (hinted.has(key)) return false;
  if (hinted.size >= MAX_TRACKED_ENCOUNTERS) hinted.clear();
  hinted.add(key);
  return true;
}

/** Test seam; production never needs to forget. */
export function resetEncounterHints(): void {
  hinted.clear();
}
