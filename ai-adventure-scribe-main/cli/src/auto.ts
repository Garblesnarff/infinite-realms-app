export interface AutoPlayable {
  pendingRolls: readonly unknown[];
  roll(): { result: { total: number } };
  play(input: string, roll?: unknown): Promise<unknown>;
}

export async function runAutoTurns(
  client: AutoPlayable,
  turns: number,
  onError: (error: unknown) => void,
): Promise<{ turnsCompleted: number; rollsMade: number; contractViolations: number }> {
  let turnsCompleted = 0;
  let rollsMade = 0;
  let contractViolations = 0;
  for (let turn = 0; turn < turns; turn += 1) {
    try {
      if (client.pendingRolls.length) {
        const roll = client.roll();
        await client.play(`I rolled ${roll.result.total}.`, roll);
        rollsMade += 1;
      } else {
        await client.play(`I choose a careful, proactive course of action (${turn + 1}).`);
      }
      turnsCompleted += 1;
    } catch (error) {
      contractViolations += 1;
      onError(error);
    }
  }
  return { turnsCompleted, rollsMade, contractViolations };
}
