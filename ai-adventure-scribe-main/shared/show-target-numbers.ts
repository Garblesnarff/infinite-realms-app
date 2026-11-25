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
 * player's local toggle, so the server follows the campaign's saved choice, then difficulty.
 */
export function showTargetNumbersByDefault(difficulty: string | null | undefined): boolean {
  const name = difficulty?.trim().toLowerCase() ?? '';
  if (name.includes('medium')) return true;
  return !name.includes('hard') && !name.includes('deadly');
}

/**
 * One rule for target numbers across client and server (#157). The player's local
 * choice wins on the client, but when it is absent (or on the server, which cannot
 * see it) the campaign's `rules_config.show_target_numbers` wins when it is a
 * boolean, and otherwise the difficulty default applies. A non-object or
 * non-boolean `rules_config` falls back to the difficulty default.
 */
export function showTargetNumbersFor(
  rulesConfig: unknown,
  difficulty: string | null | undefined,
): boolean {
  if (rulesConfig !== null && typeof rulesConfig === 'object' && !Array.isArray(rulesConfig)) {
    const flag = (rulesConfig as { show_target_numbers?: unknown }).show_target_numbers;
    if (typeof flag === 'boolean') return flag;
  }
  return showTargetNumbersByDefault(difficulty);
}

/**
 * Engine text with the target's AC or DC taken out, for the player to read when the player has
 * target numbers off (#157). Drops "vs DC 15", "vs AC 12 (+2 half cover = 14)", and a clause at
 * the start of a sentence ("vs DC 13. PASS"). Nothing is replaced with a placeholder. Only the
 * client's display calls this; the DM's copy of the engine text is not passed through here.
 */
export function hideCheckTargetNumbers(line: string): string {
  return line
    .replace(/(^|\s)vs (?:your )?(?:DC|AC) \d+(?: \([^)]*\))?\.?/g, '$1')
    .replace(/ {2,}/g, ' ')
    .trim();
}
