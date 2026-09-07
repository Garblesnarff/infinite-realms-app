/**
 * Campaign header chapter label.
 *
 * Previously this was `Chapter ${session.turn_count}`, so the left-rail / scene
 * header raced 0 → 1 → 4 → 15 across ordinary turns — including a turn with no
 * DM output (issue #1974).
 *
 * There is no DM-emitted chapter/act transition in the session or narrative
 * contract today (no `chapter_transition`, act marker, or chapter field on
 * `game_sessions`). Until that mechanism exists, freeze the displayed label.
 */
export const FROZEN_CAMPAIGN_CHAPTER_LABEL = 'Chapter 1';

/**
 * Resolve the campaign chapter shown in the session chrome.
 *
 * `turnCount` is accepted only so call sites can stop interpolating it; it is
 * intentionally ignored. Pass an explicit DM-emitted chapter title later if
 * that contract is added.
 */
export function resolveCampaignChapterLabel(turnCount?: number | null): string {
  void turnCount;
  return FROZEN_CAMPAIGN_CHAPTER_LABEL;
}
