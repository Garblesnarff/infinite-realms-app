const CHARS_PER_TOKEN = 4;

export const DM_PROMPT_TOKEN_BUDGET = 24_000;

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
