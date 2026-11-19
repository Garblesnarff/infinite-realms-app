import { abilityModifier } from '../../../../shared/ability-modifier.js';

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
  formula?: unknown;
}

// `ability_check` is a live request type (src/hooks/use-ai-response.ts), so it gets the same card.
const NARRATIVE_CHECK_TYPES = new Set(['check', 'skill_check', 'ability_check']);

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

/**
 * The stored check line with its verdict word set to the server's verdict. The DM reads the
 * stored `message`, so a client that writes `success` on a failed roll must not reach the DM with
 * that word. The formatter puts the verdict last (`... success` / `... fail`), so the word is
 * replaced there. A line with no trailing verdict gets the server's word appended.
 */
export function serverVerdictLine(text: string, success: boolean): string {
  const verdict = success ? 'success' : 'fail';
  const trimmed = text.trimEnd();
  if (/\s(success|fail)$/i.test(trimmed)) {
    return trimmed.replace(/\s(success|fail)$/i, ` ${verdict}`);
  }
  return `${trimmed} ${verdict}`;
}

/** Resolve only a server-issued formula; never use a modifier from the submitted message. */
export function issuedCheckModifier(request: IssuedRollRequest, character: unknown): number | null {
  if (typeof request.formula !== 'string') return null;
  const formula = request.formula.replace(/\s+/g, '').toLowerCase();
  const match = formula.match(/^1?d20((?:[+-]\d+)*)$/);
  if (match) return (match[1]!.match(/[+-]\d+/g) ?? []).reduce((sum, n) => sum + Number(n), 0);
  const symbolic = formula.match(
    /^1?d20([+-])(str|strength|dex|dexterity|con|constitution|int|intelligence|wis|wisdom|cha|charisma)$/,
  );
  if (!symbolic || !character || typeof character !== 'object') return null;
  const names: Record<string, string> = {
    str: 'strength',
    dex: 'dexterity',
    con: 'constitution',
    int: 'intelligence',
    wis: 'wisdom',
    cha: 'charisma',
  };
  const stats = (character as { stats?: unknown }).stats;
  const row = Array.isArray(stats) ? stats[0] : stats;
  if (!row || typeof row !== 'object') return null;
  const key = names[symbolic[2]!] ?? symbolic[2]!;
  const score = (row as Record<string, unknown>)[key];
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return (symbolic[1] === '-' ? -1 : 1) * abilityModifier(score);
}

export function narrativeCheckShadow(input: {
  text: string;
  request: IssuedRollRequest;
  context?: Record<string, unknown>;
  modifier: number | null;
}): { result: 'match' | 'mismatch' | 'no_natural' | 'no_modifier' | 'no_verdict' } | null {
  if (typeof input.request.type !== 'string' || !NARRATIVE_CHECK_TYPES.has(input.request.type))
    return null;
  const dice = input.context?.diceRoll;
  const detail =
    dice && typeof dice === 'object' && !Array.isArray(dice)
      ? (dice as Record<string, unknown>)
      : undefined;
  const fromLine = input.text.match(/\(nat\s+(\d+)(?:[+-]\d+)?\)/i);
  const faces = Array.isArray(detail?.results) ? detail.results : [];
  const pair =
    faces.length === 2 && faces.every((face) => Number.isInteger(face) && face >= 1 && face <= 20)
      ? (faces as number[])
      : null;
  const advantage = detail?.advantage === true;
  const disadvantage = detail?.disadvantage === true;
  const natural =
    typeof detail?.naturalRoll === 'number'
      ? detail.naturalRoll
      : fromLine
        ? Number(fromLine[1])
        : pair && advantage !== disadvantage
          ? advantage
            ? Math.max(...pair)
            : Math.min(...pair)
          : null;
  if (!Number.isInteger(natural) || natural! < 1 || natural! > 20) return { result: 'no_natural' };
  if (input.modifier === null) return { result: 'no_modifier' };
  const parsed = parseReportedCheckLine(input.text);
  const verdict = input.text.match(/\s(success|fail)\s*$/i)?.[1]?.toLowerCase();
  const dc = input.request.dc;
  if (!parsed || typeof dc !== 'number' || !Number.isFinite(dc) || !verdict)
    return { result: 'no_verdict' };
  const total = natural! + input.modifier;
  return {
    result:
      total === parsed.total && total >= dc === (verdict === 'success') ? 'match' : 'mismatch',
  };
}
