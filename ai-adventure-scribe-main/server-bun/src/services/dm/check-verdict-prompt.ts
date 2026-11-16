import { parseReportedCheckLine, serverVerdictLine } from '../session/narrative-check-outcome.js';

/**
 * #1477 item 1: the DM prompt carries the server's verdict for the last narrative check.
 *
 * The client sends its formatter line (`Athletics check: 9 (nat 4+5) success`) in `history`. Its
 * verdict word is the client's own comparison. The server saved an engine card for the same roll
 * (`narrativeCheckCard`), and that card's word is the verdict. This module finds the saved row that
 * matches the client's last check line and, when the words differ, rewrites the verdict word in the
 * history line and in the prompt to the server's word.
 *
 * Shadow mode: the server word always wins. A disagreement is reported by the caller as a count;
 * no user text is logged here.
 *
 * The total is compared as well as the label, so an older check line does not pick up a newer
 * row's verdict. No match leaves the client line unchanged.
 */

export interface HistoryEntry {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/** A saved narrative check row for this session: the stored line and the server's verdict word. */
export interface ServerCheckRow {
  message: string;
  verdict: 'SUCCESS' | 'FAIL';
}

export type CheckVerdictStatus = 'no_client_line' | 'no_server_row' | 'agree' | 'disagree';

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

export function reconcileCheckVerdict(input: {
  history: HistoryEntry[] | undefined;
  prompt: string;
  rows: ServerCheckRow[];
}): CheckVerdictResult {
  const unchanged = (status: CheckVerdictStatus): CheckVerdictResult => ({
    history: input.history,
    prompt: input.prompt,
    status,
  });

  const history = input.history;
  if (!Array.isArray(history)) return unchanged('no_client_line');
  let lastUser = -1;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user') {
      lastUser = i;
      break;
    }
  }
  if (lastUser < 0) return unchanged('no_client_line');

  const clientLine = history[lastUser]!.content;
  const clientVerdict = VERDICT_TAIL.exec(clientLine.trimEnd());
  const clientIdentity = checkIdentity(clientLine);
  if (!clientVerdict || !clientIdentity) return unchanged('no_client_line');

  const serverRow = input.rows.find((row) => {
    const rowIdentity = checkIdentity(row.message);
    return (
      rowIdentity !== null &&
      rowIdentity.label === clientIdentity.label &&
      rowIdentity.total === clientIdentity.total
    );
  });
  if (!serverRow) return unchanged('no_server_row');

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
