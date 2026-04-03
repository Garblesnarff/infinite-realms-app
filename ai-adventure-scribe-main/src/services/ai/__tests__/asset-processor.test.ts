import { describe, it, expect } from 'vitest';

import { insertAssetTags } from '../asset-processor';

import type { AssetInfo } from '../asset-processor';

const DIABOLO: AssetInfo = { type: 'npc', key: 'lord-diabolo', name: 'Lord Diabolo' };
const ZARA: AssetInfo = { type: 'npc', key: 'zara', name: 'Zara' };

describe('insertAssetTags — emphasis edge cases', () => {
  it('inserts tag before plain name (no emphasis)', () => {
    const result = insertAssetTags('Then you see Lord Diabolo approach.', [DIABOLO]);
    expect(result).toBe('Then you see [ASSET:npc:lord-diabolo] Lord Diabolo approach.');
  });

  it('inserts tag before *Name (leading asterisk, no space)', () => {
    const result = insertAssetTags('Then you see *Lord Diabolo approach.', [DIABOLO]);
    expect(result).toMatch(/\[ASSET:npc:lord-diabolo\] \*Lord Diabolo/);
  });

  it('inserts tag before * Name (leading asterisk with space)', () => {
    // Regression: walk-back used to stop at the space, inserting tag INSIDE the emphasis span
    const result = insertAssetTags('Then you see * Lord Diabolo approach.', [DIABOLO]);
    expect(result).toMatch(/\[ASSET:npc:lord-diabolo\] \* Lord Diabolo/);
    // Tag must NOT appear between * and the name
    expect(result).not.toMatch(/\* \[ASSET/);
  });

  it('inserts tag before **Name (double asterisks, no space)', () => {
    const result = insertAssetTags('Behold **Lord Diabolo**.', [DIABOLO]);
    expect(result).toMatch(/\[ASSET:npc:lord-diabolo\] \*\*Lord Diabolo/);
  });

  it('does not insert a second tag when already present', () => {
    const alreadyTagged = '[ASSET:npc:lord-diabolo] Lord Diabolo appeared.';
    const result = insertAssetTags(alreadyTagged, [DIABOLO]);
    expect(result).toBe(alreadyTagged);
  });

  it('handles multiple assets in one passage', () => {
    const result = insertAssetTags('* Zara spoke while * Lord Diabolo watched.', [ZARA, DIABOLO]);
    expect(result).toMatch(/\[ASSET:npc:zara\]/);
    expect(result).toMatch(/\[ASSET:npc:lord-diabolo\]/);
    // Neither tag should land between * and name
    expect(result).not.toMatch(/\* \[ASSET/);
  });

  it('returns unchanged text when assets list is empty', () => {
    const text = 'Some narrative text.';
    expect(insertAssetTags(text, [])).toBe(text);
  });
});
