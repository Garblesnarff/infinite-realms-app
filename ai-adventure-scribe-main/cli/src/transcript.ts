import { appendFileSync, writeFileSync } from 'node:fs';

import { getLastRequestId } from './request-id';

/**
 * Append-only transcript writer. The file is truncated when the writer is
 * created and every line is flushed immediately, so a crash keeps everything
 * written up to the crash.
 *
 * Each line is prefixed with the request id of the response that produced it
 * (`[req <id>] `, or `[req -] ` when unknown). This applies to `--json` output
 * too: rather than special-casing a `requestId` field into JSON lines, the
 * writer prepends the same prefix so one format-agnostic path serves both.
 */
export interface TranscriptWriter {
  write(line: string): void;
}

export function createTranscriptWriter(
  filePath: string,
  getRequestId: () => string | undefined = getLastRequestId,
): TranscriptWriter {
  writeFileSync(filePath, '');
  return {
    write(line: string): void {
      appendFileSync(filePath, `[req ${getRequestId() ?? '-'}] ${line}\n`);
    },
  };
}
