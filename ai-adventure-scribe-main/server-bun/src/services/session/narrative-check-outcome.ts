import type { EngineResultCard } from '../../../../shared/engine-result-card.js';

/**
 * #1477: the server's outcome for a narrative ability check.
 *
 * The DC is the server's: it comes from the DM row that issued the roll request in this session
 * (see `SessionMessageService.findIssuedRollRequest`). The SUCCESS / FAIL word is computed here,
 * never read from the client's `success` / `fail` word on the saved line.
 *
 * The die total still comes from the client. It is parsed from the formatter line
 * (`<purpose>: <total> (nat N+M) ... success|fail`) until #1423 moves the die to the engine
 * result. Until then the total is the client's report, and only the DC and the verdict are the
 * server's.
 */

/** A roll request as the DM row stored it. Only the fields this module reads are typed. */
export interface IssuedRollRequest {
  type?: unknown;
  dc?: unknown;
  rollRequestId?: unknown;
}

const NARRATIVE_CHECK_TYPES = new Set(['check', 'skill_check']);

/**
 * Reads the label and the reported total from the formatter line. The label is everything before
 * the last `: <number>`, so a purpose with a colon in it still parses.
 */
export function parseReportedCheckLine(text: string): { label: string; total: number } | null {
  const match = text.match(/^(.*):\s*(-?\d+)(?=\s|$)/);
  if (!match) return null;
  const label = match[1]!.trim();
  if (!label) return null;
  return { label, total: Number(match[2]) };
}

/**
 * The engine card for a narrative check the server issued. Returns null when the request is not a
 * narrative check, has no numeric DC, or the line has no reported total. The caller logs the null.
 */
export function narrativeCheckCard(input: {
  text: string;
  request: IssuedRollRequest;
}): EngineResultCard | null {
  if (typeof input.request.type !== 'string' || !NARRATIVE_CHECK_TYPES.has(input.request.type)) {
    return null;
  }
  const dc = input.request.dc;
  if (typeof dc !== 'number' || !Number.isFinite(dc)) return null;
  const parsed = parseReportedCheckLine(input.text);
  if (!parsed) return null;

  const success = parsed.total >= dc;
  const word = success ? 'SUCCESS' : 'FAIL';
  const numbers = `${parsed.total} vs DC ${dc}`;
  return {
    kind: 'check',
    side: 'party',
    line: `${parsed.label}: ${numbers}, ${word}`,
    title: parsed.label,
    badge: {
      word,
      tone: success ? 'gold' : 'red',
      icon: success ? 'check' : 'alert',
    },
    detail: numbers,
  };
}
