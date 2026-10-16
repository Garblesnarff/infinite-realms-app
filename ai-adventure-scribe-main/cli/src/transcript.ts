import { appendFileSync, writeFileSync } from 'node:fs';

import { getLastRequestId } from './request-id';

/**
 * Append-only transcript writer. The file is truncated when the writer is
 * created and every line is flushed immediately, so a crash keeps everything
 * written up to the crash.
 *
 * Each line is prefixed with the request id of the response that produced it
 * (`[req <id>] `, or `[req -] ` when unknown). A JSON-object line (`--json`
 * events, the summary) instead gets a `requestId` field, so the file stays JSONL.
 * The id is the latest `x-request-id` any response carried, not per-call.
 */
export interface TranscriptWriter {
  write(line: string): void;
}

/** A JSON-object line (`--json`) gets a `requestId` field so it stays valid JSONL. */
function withRequestId(line: string, requestId: string | null): string {
  if (line.startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify({ ...parsed, requestId });
      }
    } catch {
      // Not JSON after all: fall through to the text prefix.
    }
  }
  return `[req ${requestId ?? '-'}] ${line}`;
}

export function createTranscriptWriter(
  filePath: string,
  getRequestId: () => string | undefined = getLastRequestId,
): TranscriptWriter {
  writeFileSync(filePath, '');
  return {
    write(line: string): void {
      appendFileSync(filePath, `${withRequestId(line, getRequestId() ?? null)}\n`);
    },
  };
}
