import { describe, expect, it, vi } from 'vitest';

import { parseJsonIfString } from '../parse-json-if-string';

describe('parseJsonIfString', () => {
  it('returns objects as-is instead of JSON.parse-ing them', () => {
    const parseSpy = vi.spyOn(JSON, 'parse');
    const alreadyParsed = [{ id: 'mapping-1' }];

    expect(parseJsonIfString(alreadyParsed)).toBe(alreadyParsed);
    expect(parseSpy).not.toHaveBeenCalled();
    parseSpy.mockRestore();
  });

  it('parses JSON strings', () => {
    expect(parseJsonIfString('[{"id":"mapping-1"}]')).toEqual([{ id: 'mapping-1' }]);
  });

  it('lets JSON.parse throw on the coerced "[object Object]" string', () => {
    expect(() => parseJsonIfString('[object Object]')).toThrow(/not valid JSON/);
  });
});
