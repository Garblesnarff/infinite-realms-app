import { Elysia } from 'elysia';

import { logger } from '../lib/logger.js';
import { createSimpleRateLimit } from '../middleware/rate-limit.js';

/**
 * CSP violation report collector (#283).
 *
 * Browsers POST violation reports here when the Content-Security-Policy
 * `report-uri` directive fires. Public endpoint: no auth, small body limit,
 * per-IP rate limit, always 204. Only the violated directive and the blocked
 * URI are logged — never document-uri, cookies, or other report fields, which
 * can carry user data.
 */

/** Maximum accepted report body: 8 KB (#283). */
export const CSP_REPORT_MAX_BODY_BYTES = 8192;

interface CspReportBody {
  // Classic `report-uri` shape: kebab-case keys under "csp-report".
  'violated-directive'?: unknown;
  'blocked-uri'?: unknown;
  // Reporting API (`report-to`, application/reports+json): camelCase keys
  // inside the array entry's "body".
  effectiveDirective?: unknown;
  blockedURL?: unknown;
}

export function extractReport(payload: unknown): CspReportBody {
  if (typeof payload !== 'object' || payload === null) return {};
  // Reporting API: an array of { type, body: {...} } with camelCase keys.
  // Prefer the csp-violation entry (browsers can batch other report types);
  // fall back to the first entry that carries a body object.
  if (Array.isArray(payload)) {
    let fallback: CspReportBody | undefined;
    for (const entry of payload) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      const body = record['body'];
      if (typeof body !== 'object' || body === null) continue;
      if (record['type'] === 'csp-violation') return body as CspReportBody;
      fallback ??= body as CspReportBody;
    }
    return fallback ?? {};
  }
  const record = payload as Record<string, unknown>;
  // Classic `report-uri` shape: { "csp-report": { ... } }.
  const nested = record['csp-report'];
  if (typeof nested !== 'object' || nested === null) return {};
  return nested as CspReportBody;
}

/**
 * Log sampling (#302 FIX item 3): violation reports can arrive in bursts — one
 * misconfigured page makes every visitor's browser report at once, and the
 * 30/min/IP rate limit still allows 30 info lines per IP per minute. Log the
 * first accepted report (isolated violations stay visible) and every Nth
 * after that, with the cumulative total so volume is observable. Reports
 * with no usable directive or blocked URI are not counted.
 */
const INFO_LOG_EVERY_NTH_REPORT = 10;
let totalAcceptedReports = 0;
let reportsSinceInfoLog = 0;

function logReportSampled(directive: string | undefined, blockedUri: string | undefined): void {
  if (directive === undefined && blockedUri === undefined) return;
  totalAcceptedReports += 1;
  reportsSinceInfoLog += 1;
  const isFirst = totalAcceptedReports === 1;
  if (!isFirst && reportsSinceInfoLog < INFO_LOG_EVERY_NTH_REPORT) return;
  logger.info(
    { directive, blockedUri, totalReports: totalAcceptedReports },
    'csp_violation_report',
  );
  reportsSinceInfoLog = 0;
}

export const cspReportRoutes = new Elysia()
  .use(
    createSimpleRateLimit({
      windowMs: 60_000,
      max: 30,
      key: 'csp-report',
      // At most one rate-limit warn per IP per minute (#302 FIX item 3).
      warnThrottleMs: 60_000,
    }),
  )
  .post('/csp-report', async ({ request, set }) => {
    const contentLengthHeader = request.headers.get('content-length');
    const contentLength = contentLengthHeader === null
      ? 0
      : Math.max(0, Math.min(Number.parseInt(contentLengthHeader, 10) || 0, 1_000_000_000));
    if (contentLength > CSP_REPORT_MAX_BODY_BYTES) {
      set.status = 413;
      return;
    }

    try {
      // Stream the body with a hard cap: request.text() would buffer an
      // unbounded chunked body into memory before we can check its size.
      const reader = request.body?.getReader();
      if (!reader) {
        set.status = 204;
        return;
      }
      const chunks: Uint8Array[] = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > CSP_REPORT_MAX_BODY_BYTES) {
          await reader.cancel();
          set.status = 413;
          return;
        }
        chunks.push(value);
      }
      const text = new TextDecoder().decode(
        chunks.length === 1 ? chunks[0] : concatChunks(chunks, total),
      );
      const report = extractReport(JSON.parse(text));
      const directive = sanitizeLogField(
        report['violated-directive'] ?? report['effectiveDirective'],
      );
      const blockedUri = sanitizeLogField(report['blocked-uri'] ?? report['blockedURL']);
      // Directive + blocked URI only. document-uri and the rest of the report
      // can contain user-identifying data and are deliberately dropped.
      // Sampled: see logReportSampled (#302 FIX item 3).
      logReportSampled(directive, blockedUri);
    } catch {
      // Malformed or non-JSON body: still 204, nothing to log.
    }

    set.status = 204;
  });

function concatChunks(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Keep a logged field to a single safe line: drop non-strings, strip control
 * characters (log injection), and truncate. The 8 KB body cap bounds length,
 * but a single field could still be a multi-KB line.
 *
 * For blocked-uri: a URL's query string or fragment can carry tokens or
 * signed-URL signatures, so log origin + pathname only. Non-URL tokens
 * ('inline', 'eval', ...) pass through as-is; data: URIs are truncated hard
 * since they can embed entire payloads.
 */
function sanitizeLogField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  // eslint-disable-next-line no-control-regex
  let cleaned = value.replace(/[\x00-\x1f\x7f]/g, '');
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(cleaned)) {
    try {
      const url = new URL(cleaned);
      if (url.protocol === 'data:') {
        cleaned = 'data:[truncated]';
      } else {
        cleaned = url.origin + url.pathname;
      }
    } catch {
      // Not a parseable URL — treat as an opaque token below.
    }
  }
  cleaned = cleaned.slice(0, 500);
  return cleaned || undefined;
}
