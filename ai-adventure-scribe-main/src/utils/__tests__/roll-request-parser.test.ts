import { describe, it, expect } from 'vitest';

import { parseRollRequests, containsAC } from '@/utils/rollRequestParser';

describe('rollRequestParser', () => {
  it('parses structured roll requests when the model misspells purpose as purity', () => {
    const msg = [
      '```ROLL_REQUESTS_V1',
      '{',
      '  "rolls": [',
      '    {',
      '      "type": "check",',
      '      "formula": "1d20+3",',
      '      "purity": "Insight check",',
      '      "dc": 14',
      '    }',
      '  ]',
      '}',
      '```',
    ].join('\n');

    const out = parseRollRequests(msg);

    expect(out).toHaveLength(1);
    expect(out[0].type).toBe('check');
    expect(out[0].formula).toBe('1d20+3');
    expect(out[0].purpose).toBe('Insight check');
    expect(out[0].dc).toBe(14);
  });

  it('parses skill check with DC', () => {
    const msg = 'Roll for Stealth (DC 14)';
    const out = parseRollRequests(msg);
    expect(out.length).toBeGreaterThan(0);
    const rr = out.find((r) => r.type === 'check');
    expect(rr).toBeTruthy();
    expect(rr!.purpose?.toLowerCase()).toContain('stealth');
    expect(rr!.dc).toBe(14);
  });

  it('parses attack roll with AC', () => {
    const msg = 'Make an attack roll with your longsword (1d20+5) against AC 15';
    const out = parseRollRequests(msg);
    expect(out.some((r) => r.type === 'attack')).toBe(true);
    expect(containsAC(msg)).toBe(true);
  });

  it('parses damage roll with explicit dice', () => {
    const msg = 'Roll 1d8+3 for damage';
    const out = parseRollRequests(msg);
    expect(out.some((r) => r.type === 'damage')).toBe(true);
  });
});
