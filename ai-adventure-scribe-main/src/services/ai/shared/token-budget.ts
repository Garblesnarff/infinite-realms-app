const CHARS_PER_TOKEN = 4;

export const DM_PROMPT_TOKEN_BUDGET = 24_000;

/**
 * #2450: the DM prompt always reserves this many tokens for conversation
 * history (~the last 6-8 turns). The canon block shrinks to fit, not history:
 * a campaign whose canon exceeds the budget must never again leave zero
 * history tokens the way the 27k-token Academy canon did.
 */
export const DM_HISTORY_TOKEN_FLOOR = 4_000;

/**
 * #2450: hard cap on the rendered starter-campaign lore section. Canon beyond
 * this is relevance-ranked (recent turns first, active scene entities always
 * kept) and the remainder is dropped with a warn-level alarm.
 */
export const DM_CANON_TOKEN_CAP = 13_000;

/**
 * #2533: per-turn cap on the entity cards chosen by name for the canon block (cards for
 * entities in the current scene are exempt and always kept). Roughly eight 350-token cards.
 */
export const DM_TURN_CANON_ENTITY_TOKEN_BUDGET = 3_000;

/**
 * #2533: the DM prompt carries the last 12 messages (~6 player/DM exchanges; system and companion rows count too) of the
 * transcript, not all of it. Six exchanges cover the longest span the prompt itself asks for
 * (DM requests a roll, player rolls, DM narrates) plus the thread being continued; what
 * happened earlier reaches the DM through `<scene_state>` (the fact ledger, which wins over
 * history) and `<story_memories>`, both of which are sent every turn. History used to grow
 * ~230 tokens per turn without bound (519 -> 4,402 over 22 turns in run D4).
 */
export const DM_HISTORY_MAX_MESSAGES = 12;

export function approximateTokens(value: string): number {
  return Math.ceil(value.length / CHARS_PER_TOKEN);
}

export function selectRecentMessagesWithinTokenBudget<T>(
  messages: T[],
  render: (message: T) => string,
  tokenBudget: number,
): string[] {
  const selected: string[] = [];
  let remaining = Math.max(0, tokenBudget);

  for (let index = messages.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const rendered = render(messages[index]);
    const cost = approximateTokens(rendered);
    if (cost > remaining) continue;
    selected.unshift(rendered);
    remaining -= cost;
  }

  return selected;
}
