import { describe, expect, it } from 'bun:test';
import uri from 'fast-uri';

// The server's Ajv validators use this lockfile dependency. These are parser regressions,
// not a claim that application code exposes an SSRF endpoint (#843).
describe('fast-uri authority regressions (#843)', () => {
  it('rejects a literal backslash authority instead of silently accepting the allowlisted host', () => {
    expect(uri.parse('http://evil.example\\@allowed.example').error).toBeTruthy();
  });

  it('rejects a delimiter-bearing port rather than changing the destination host', () => {
    expect(() =>
      uri.serialize({
        scheme: 'http',
        host: 'trusted.example',
        path: '/app',
        port: '@127.0.0.1:8124' as unknown as number,
      }),
    ).toThrow();
  });

  it('retains ordinary schema reference resolution', () => {
    expect(
      uri.resolve('https://schema.example/definitions/base.json', '../common.json#/$defs/text'),
    ).toBe('https://schema.example/common.json#/$defs/text');
  });
});
