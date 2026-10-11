import { describe, expect, it, spyOn } from 'bun:test';

import { createRequestPipelineApp, setSecurityHeaders } from '../../http-pipeline.js';
import { logger } from '../../lib/logger.js';
import { CSP_REPORT_MAX_BODY_BYTES, cspReportRoutes, extractReport } from '../csp-report.js';

// #283. The browser POSTs violation reports here when the Report-Only
// `report-uri` directive fires. These go through the real request pipeline
// with no Authorization header, the way a browser sends them.

function testApp() {
  return createRequestPipelineApp().use(cspReportRoutes);
}

/** A realistic `report-uri` body as Chrome sends it (application/csp-report). */
function chromeReportBody(): string {
  return JSON.stringify({
    'csp-report': {
      'document-uri': 'https://app.example.com/game',
      referrer: 'https://app.example.com/',
      'violated-directive': 'script-src',
      'effective-directive': 'script-src',
      'original-policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; report-uri /csp-report",
      'blocked-uri': 'https://evil.example.com/x.js',
      'line-number': 42,
      'source-file': 'https://app.example.com/game',
      'status-code': 200,
    },
  });
}

function postReport(body: string, headers: Record<string, string> = {}): Promise<Response> {
  const app = testApp();
  return app.handle(
    new Request('http://localhost/csp-report', {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', ...headers },
      body,
    }),
  );
}

describe('POST /csp-report', () => {
  it('accepts a browser report with 204 and no auth', async () => {
    const res = await postReport(chromeReportBody());
    expect(res.status).toBe(204);
  });

  it('accepts the real Reporting API shape (array of { type, body })', async () => {
    // What browsers actually send with `report-to` (application/reports+json):
    // an array of reports with camelCase keys inside body (#302 FIX item 4).
    const res = await postReport(
      JSON.stringify([
        {
          type: 'csp-violation',
          age: 0,
          url: 'https://app.example.com/game',
          user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
          body: {
            documentURL: 'https://app.example.com/game',
            effectiveDirective: 'img-src',
            blockedURL: 'https://evil.example.com/pixel.png',
            statusCode: 200,
          },
        },
      ]),
      { 'content-type': 'application/reports+json' },
    );
    expect(res.status).toBe(204);
  });

  it('still 204s on a Reporting API array with no usable body', async () => {
    const res = await postReport(JSON.stringify([{ type: 'csp-violation' }]), {
      'content-type': 'application/reports+json',
    });
    expect(res.status).toBe(204);
  });

  it('still 204s on malformed JSON instead of 500', async () => {
    const res = await postReport('not json{{{');
    expect(res.status).toBe(204);
  });

  it('rejects bodies over 8 KB with 413', async () => {
    const big = JSON.stringify({
      'csp-report': {
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/' + 'x'.repeat(CSP_REPORT_MAX_BODY_BYTES),
      },
    });
    expect(big.length).toBeGreaterThan(CSP_REPORT_MAX_BODY_BYTES);
    const res = await postReport(big, { 'content-length': String(big.length) });
    expect(res.status).toBe(413);
  });

  it('rejects oversized chunked bodies with no content-length (streaming cap)', async () => {
    const big = 'x'.repeat(CSP_REPORT_MAX_BODY_BYTES + 1);
    const app = testApp();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    const res = await app.handle(
      new Request('http://localhost/csp-report', {
        method: 'POST',
        headers: { 'content-type': 'application/csp-report' },
        body: stream,
        // @ts-expect-error - duplex is required for streaming bodies in undici
        duplex: 'half',
      }),
    );
    expect(res.status).toBe(413);
  });

  it('rate-limits per IP (31st request in a minute is 429)', async () => {
    const app = testApp();
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await app.handle(
        new Request('http://localhost/csp-report', {
          method: 'POST',
          headers: { 'content-type': 'application/csp-report' },
          body: chromeReportBody(),
        }),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('throttles rate-limit warns to one per IP per minute', async () => {
    // #302 FIX item 3: the 429 path must not warn on every rejected request.
    // A dedicated IP (via trusted x-forwarded-for) gets a fresh bucket.
    const warnSpy = spyOn(logger, 'warn');
    process.env.TRUST_PROXY_HEADERS = '1';
    try {
      const app = testApp();
      const headers = {
        'content-type': 'application/csp-report',
        'x-forwarded-for': '10.9.8.7',
      };
      let rejected = 0;
      for (let i = 0; i < 35; i++) {
        const res = await app.handle(
          new Request('http://localhost/csp-report', {
            method: 'POST',
            headers,
            body: chromeReportBody(),
          }),
        );
        if (res.status === 429) rejected += 1;
      }
      expect(rejected).toBeGreaterThan(1);
      const throttleWarns = warnSpy.mock.calls.filter((args) =>
        String(args[0]).includes('Simple rate limit exceeded'),
      );
      expect(throttleWarns.length).toBe(1);
    } finally {
      warnSpy.mockRestore();
      delete process.env.TRUST_PROXY_HEADERS;
    }
  });
});

describe('extractReport', () => {
  it('parses the classic report-uri shape (kebab-case under csp-report)', () => {
    const report = extractReport({
      'csp-report': {
        'violated-directive': 'script-src',
        'blocked-uri': 'https://evil.example.com/x.js',
      },
    });
    expect(report['violated-directive']).toBe('script-src');
    expect(report['blocked-uri']).toBe('https://evil.example.com/x.js');
  });

  it('parses the real Reporting API array shape (camelCase in body)', () => {
    const report = extractReport([
      {
        type: 'csp-violation',
        age: 0,
        url: 'https://app.example.com/game',
        body: {
          documentURL: 'https://app.example.com/game',
          effectiveDirective: 'img-src',
          blockedURL: 'https://evil.example.com/pixel.png',
        },
      },
    ]);
    expect(report['effectiveDirective']).toBe('img-src');
    expect(report['blockedURL']).toBe('https://evil.example.com/pixel.png');
  });

  it('prefers the csp-violation entry when other report types are batched', () => {
    const report = extractReport([
      { type: 'deprecation', body: { id: 'x', message: 'old' } },
      {
        type: 'csp-violation',
        body: { effectiveDirective: 'script-src', blockedURL: 'https://evil.example.com/a.js' },
      },
    ]);
    expect(report['effectiveDirective']).toBe('script-src');
    expect(report['blockedURL']).toBe('https://evil.example.com/a.js');
  });

  it('falls back to the first entry with a body when no csp-violation entry exists', () => {
    const report = extractReport([{ type: 'deprecation', body: { id: 'x' } }]);
    expect((report as Record<string, unknown>)['id']).toBe('x');
  });

  it('returns {} for empty arrays, non-object entries, and garbage', () => {
    expect(extractReport([])).toEqual({});
    expect(extractReport(['nope', 42, null])).toEqual({});
    expect(extractReport([{ type: 'csp-violation' }])).toEqual({});
    expect(extractReport(null)).toEqual({});
    expect(extractReport('string')).toEqual({});
    expect(extractReport({})).toEqual({});
    expect(extractReport({ 'csp-report': null })).toEqual({});
  });
});

describe('Content-Security-Policy-Report-Only header', () => {
  it('includes report-uri /csp-report (#283)', async () => {
    const app = createRequestPipelineApp();
    const res = await app.handle(new Request('http://localhost/health'));
    const header = res.headers.get('content-security-policy-report-only');
    expect(header).toContain('report-uri /csp-report');
  });

  it('setSecurityHeaders still sends the header without the app', () => {
    const headers: Record<string, string> = {};
    setSecurityHeaders({ set: { headers } } as never);
    expect(headers['Content-Security-Policy-Report-Only']).toContain('report-uri /csp-report');
  });
});
