import { parseReportedCheckLine, serverVerdictLine } from '../session/narrative-check-outcome.js';

/**
 * #1477 item 1: the DM prompt carries the server's verdict for the narrative check being answered.
 *
 * The client sends its formatter line (`Athletics check: 9 (nat 4+5) success`) in `history`, and its
 * verdict word is the client's own comparison. The turn answers one roll request, named by
 * `dmReply.rollRequestId`. The server saved that roll's row with an engine `check` card, and the
 * card's word is the verdict.
 *
 * The saved row is matched by roll request id only. A row with the same label and total from another
 * roll is never used. When no saved row carries the current request id, or its line does not match
 * the client's line, the client line stays as the client wrote it and the caller logs
 * `DM_CHECK_VERDICT_NO_ROW` (a count only).
 *
 * When the words differ, the verdict word is rewritten in the history line and in the prompt's echo
 * of that line (only when the line occurs exactly once in the prompt). Nothing else changes.
 */

export interface HistoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** A saved narrative check row for this session: the roll it answers, its stored line and verdict. */
export interface ServerCheckRow {
  rollRequestId: string;
  message: string;
  verdict: 'SUCCESS' | 'FAIL';
}

export type CheckVerdictStatus = 'no_client_line' | 'no_row' | 'agree' | 'disagree';

export interface CheckVerdictResult {
  history: HistoryEntry[] | undefined;
  prompt: string;
  status: CheckVerdictStatus;
}

const VERDICT_TAIL = /\s(success|fail)$/i;

const checkIdentity = (line: string): { label: string; total: number } | null => {
  const parsed = parseReportedCheckLine(line.replace(VERDICT_TAIL, ''));
  return parsed ? { label: parsed.label, total: parsed.total } : null;
};

/**
 * The index and text of the last user history line that is a check line, or null. Used by the
 * route to decide whether a lookup is needed at all.
 */
export function lastCheckLine(history: HistoryEntry[] | undefined): string | null {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const entry = history[i];
    if (entry?.role !== 'user') continue;
    const line = entry.content;
    return VERDICT_TAIL.test(line.trimEnd()) && checkIdentity(line) ? line : null;
  }
  return null;
}

export function reconcileCheckVerdict(input: {
  history: HistoryEntry[] | undefined;
  prompt: string;
  /** `dmReply.rollRequestId` from the request: the roll this turn answers. */
  rollRequestId: string | undefined;
  /** The saved check rows for this session and roll request (the route queries by id). */
  rows: ServerCheckRow[];
}): CheckVerdictResult {
  const unchanged = (status: CheckVerdictStatus): CheckVerdictResult => ({
    history: input.history,
    prompt: input.prompt,
    status,
  });

  const history = input.history;
  const clientLine = lastCheckLine(history);
  if (!Array.isArray(history) || clientLine === null) return unchanged('no_client_line');
  const lastUser = history.map((entry) => entry.role).lastIndexOf('user');

  const clientVerdict = VERDICT_TAIL.exec(clientLine.trimEnd());
  const clientIdentity = checkIdentity(clientLine);
  if (!clientVerdict || !clientIdentity) return unchanged('no_client_line');

  // Exact match only: the same roll request id, and the same label and total as the client's line.
  const serverRow =
    input.rollRequestId === undefined
      ? undefined
      : input.rows.find((row) => {
          const rowIdentity = checkIdentity(row.message);
          return (
            row.rollRequestId === input.rollRequestId &&
            rowIdentity !== null &&
            rowIdentity.label === clientIdentity.label &&
            rowIdentity.total === clientIdentity.total
          );
        });
  if (!serverRow) return unchanged('no_row');

  const clientWord = clientVerdict[1]!.toUpperCase();
  if (clientWord === serverRow.verdict) return unchanged('agree');

  const serverLine = serverVerdictLine(clientLine, serverRow.verdict === 'SUCCESS');
  const nextHistory = history.map((entry, index) =>
    index === lastUser ? { ...entry, content: serverLine } : entry,
  );
  // The prompt echoes the player's line (the `<player_input>` block). Replace it only when the
  // client line occurs exactly once, so no other text is touched.
  const occurrences = input.prompt.split(clientLine).length - 1;
  const nextPrompt =
    occurrences === 1 ? input.prompt.split(clientLine).join(serverLine) : input.prompt;
  return { history: nextHistory, prompt: nextPrompt, status: 'disagree' };
}
