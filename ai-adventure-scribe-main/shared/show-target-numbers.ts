/**
 * Whether a surface words a roll against its target number ("vs AC 15", "vs DC 13")
 * when the player has not chosen the setting themselves.
 *
 * Easy and any difficulty with "medium" in its name show a target's AC and a save's DC;
 * Hard and Deadly do not (#2393, Rob 2026-10-01). A difficulty that is none of these
 * shows them.
 *
 * One function for every surface: the client's "Show target numbers" default and the
 * server narration that hands the same numbers to the DM. The server cannot see the
 * player's local toggle, so on the server difficulty is all this ever follows.
 */
export function showTargetNumbersByDefault(difficulty: string | null | undefined): boolean {
  const name = difficulty?.trim().toLowerCase() ?? '';
  if (name.includes('medium')) return true;
  return !name.includes('hard') && !name.includes('deadly');
}
