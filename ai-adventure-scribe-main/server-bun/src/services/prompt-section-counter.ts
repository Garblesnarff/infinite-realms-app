/**
 * Server-side per-section prompt token counts for /v1/llm/generate (#2533).
 *
 * The client already estimates some sections and sends them as `metrics`
 * (see src/services/ai/shared/prompt-metrics.ts), but that record lumps
 * memory recall, the rules/persona blocks and the character sheet into the
 * single `campaign_and_canon` number -- exactly the split #2533 needs in
 * order to price a turn. The prompt the server actually receives carries
 * those sections as tagged blocks, so the server can count them itself,
 * for any client version, without changing what is sent to the provider.
 *
 * Counts only: this module returns numbers, never prompt text, so its
 * output is safe to log verbatim. The estimator matches the client's
 * `approximateTokens` (src/services/ai/shared/token-budget.ts): one token
 * per four characters, rounded up. It is an estimate, not a provider
 * tokenizer count; `ai_usage` remains the billed-token record.
 *
 * Section mapping (tagged blocks in the assembled DM prompt, see
 * src/services/ai-service.ts `fullPrompt` and the ContextBuilder /
 * GameContextPrompts / CampaignContextPrompts renderers):
 * - `campaign_and_canon`: `<starter_campaign_lore>`, `<campaign_details>`,
 *   `<available_visual_assets>` and `<available_handouts>` blocks.
 * - `memory_recall`: `<story_memories>` and `<previous_session_recap>`.
 * - `scene_state`: `<scene_state>` and `<current_scene>`.
 * - `engine_lines`: the `<tactical_context>` block (the tactical digest:
 *   turn order, combatant state, and the engine's resolved outcomes as
 *   lines of text). Resolved outcomes do arrive inside that block: the
 *   tactical endpoint builds `<engine_resolved_outcomes>` into the
 *   tacticalContext string (server-bun/src/routes/v1/tactical-maps.ts)
 *   and the client wraps the whole string in `<tactical_context>`
 *   (src/services/ai-service.ts), so extracting the outer block captures
 *   them. `<engine_resolved_outcomes>` itself is deliberately not
 *   extracted -- the rules sections also mention it in backticks, and
 *   pairing those mentions with a close tag would misattribute text.
 * - `history`: the `<conversation_history>` block, plus any messages sent
 *   separately in the request `history` array.
 * - `player_input`: the `<player_input>` block.
 * - `system_rules`: everything else -- persona, rules of play, response
 *   structure, final reminders, the `<game_context>` / `<character_details>`
 *   wrappers and character sheet, and the
 *   `<immutable_game_state>` / `<security_rules>` system block. It is the
 *   remainder, so the sections always sum to `total`.
 *
 * Extraction is mention-proof and linear: each close tag is paired with
 * the nearest preceding open tag, scanned with indexOf (no regex, so
 * adversarial input cannot cause backtracking). Real prompt text mentions
 * tag names inline -- e.g. the `<story_memories>` header says "where a
 * memory conflicts with <scene_state>, the <scene_state> facts are
 * correct" -- and those unclosed mentions are not opens: they stay with
 * the text around them. Untrusted history text that contains a closing
 * tag can still move characters between sections, but can never change
 * `total`, throw, or leak text into the counts.
 *
 * Scope of the count: this counts the prompt as the client sent it. The
 * server may append a `<declared_attack>` directive before the provider
 * call, and contract enforcement may issue a corrective re-prompt inside
 * the same request; neither is in this count. Provider-billed input is
 * recorded separately in `ai_usage`.
 */

export interface PromptSectionTokenCounts {
  system_rules: number;
  campaign_and_canon: number;
  scene_state: number;
  memory_recall: number;
  history: number;
  engine_lines: number;
  player_input: number;
  total: number;
}

const CHARS_PER_TOKEN = 4;

export function approximatePromptTokens(value: string): number {
  return Math.ceil(value.length / CHARS_PER_TOKEN);
}

function takeTaggedBlocks(text: string, tag: string): { taken: string; rest: string } {
  const openPrefix = `<${tag}`;
  const closeTag = `</${tag}>`;
  let taken = '';
  let rest = '';
  // Text before `segmentStart` has been accounted for (moved to taken or
  // rest). Opens seen since then are candidates for the next close; the
  // nearest one wins, so an inline mention of the tag name earlier in the
  // text (an open with no close of its own) is never paired.
  let segmentStart = 0;
  let cursor = 0;
  const opens: number[] = [];
  for (;;) {
    const close = text.indexOf(closeTag, cursor);
    if (close === -1) break;
    // Collect every well-formed open before this close.
    let opensExhausted = false;
    for (;;) {
      const open = text.indexOf(openPrefix, cursor);
      if (open === -1) {
        opensExhausted = true;
        break;
      }
      if (open >= close) break;
      const afterName = text[open + openPrefix.length];
      if (afterName !== '>' && afterName !== ' ' && afterName !== '\t' && afterName !== '\n') {
        // A longer tag that merely starts with this name (e.g. <scene_state_x>).
        cursor = open + openPrefix.length;
        continue;
      }
      opens.push(open);
      cursor = open + openPrefix.length;
    }
    const open = opens.length > 0 ? opens[opens.length - 1] : -1;
    if (open === -1) {
      // A close with no open since the last extracted block: leave it in
      // the remaining text and keep scanning after it. If no opens remain
      // anywhere ahead, no later close can pair either -- stop entirely.
      if (opensExhausted) break;
      cursor = close + closeTag.length;
      continue;
    }
    const openEnd = text.indexOf('>', open);
    if (openEnd === -1 || openEnd > close) {
      cursor = close + closeTag.length;
      continue;
    }
    taken += text.slice(open, close + closeTag.length);
    rest += text.slice(segmentStart, open);
    segmentStart = close + closeTag.length;
    cursor = segmentStart;
    opens.length = 0;
  }
  rest += text.slice(segmentStart);
  return { taken, rest };
}

export function countPromptSections(
  prompt: string,
  historyMessages?: Array<{ content?: unknown }> | null,
): PromptSectionTokenCounts {
  let rest = typeof prompt === 'string' ? prompt : '';

  // History first: history text may itself quote the other tags, and the
  // production assembly embeds history before <player_input>.
  const historyTaken = takeTaggedBlocks(rest, 'conversation_history');
  let historyText = historyTaken.taken;
  rest = historyTaken.rest;
  if (Array.isArray(historyMessages)) {
    for (const message of historyMessages) {
      if (message && typeof message.content === 'string') historyText += message.content;
    }
  }

  const sections: Record<keyof PromptSectionTokenCounts, string> = {
    system_rules: '',
    campaign_and_canon: '',
    scene_state: '',
    memory_recall: '',
    history: historyText,
    engine_lines: '',
    player_input: '',
    total: '',
  };

  const takeInto = (key: keyof PromptSectionTokenCounts, tags: readonly string[]): void => {
    for (const tag of tags) {
      const taken = takeTaggedBlocks(rest, tag);
      sections[key] += taken.taken;
      rest = taken.rest;
    }
  };

  takeInto('player_input', ['player_input']);
  takeInto('scene_state', ['scene_state', 'current_scene']);
  takeInto('engine_lines', ['tactical_context']);
  takeInto('memory_recall', ['story_memories', 'previous_session_recap']);
  takeInto('campaign_and_canon', [
    'starter_campaign_lore',
    'campaign_details',
    'available_visual_assets',
    'available_handouts',
  ]);

  sections.system_rules = rest;

  const counts: PromptSectionTokenCounts = {
    system_rules: approximatePromptTokens(sections.system_rules),
    campaign_and_canon: approximatePromptTokens(sections.campaign_and_canon),
    scene_state: approximatePromptTokens(sections.scene_state),
    memory_recall: approximatePromptTokens(sections.memory_recall),
    history: approximatePromptTokens(sections.history),
    engine_lines: approximatePromptTokens(sections.engine_lines),
    player_input: approximatePromptTokens(sections.player_input),
    total: 0,
  };
  counts.total =
    counts.system_rules +
    counts.campaign_and_canon +
    counts.scene_state +
    counts.memory_recall +
    counts.history +
    counts.engine_lines +
    counts.player_input;
  return counts;
}
