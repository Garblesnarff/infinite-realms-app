import { describe, it, expect } from 'vitest';
import { stripAssetTags } from './utils';

describe('stripAssetTags', () => {
  it('should remove a single asset tag from the beginning of a string', () => {
    const input = '[ASSET:npc:balthazar] Balthazar lets out a booming laugh.';
    const expected = 'Balthazar lets out a booming laugh.';
    expect(stripAssetTags(input)).toBe(expected);
  });

  it('should remove a single asset tag from the end of a string', () => {
    const input = 'The void shark is near. [ASSET:monster:void_shark]';
    const expected = 'The void shark is near.';
    expect(stripAssetTags(input)).toBe(expected);
  });

  it('should remove multiple asset tags from a string', () => {
    const input = '[ASSET:npc:balthazar] [ASSET:scene:kitchen] Balthazar is in the kitchen.';
    const expected = 'Balthazar is in the kitchen.';
    expect(stripAssetTags(input)).toBe(expected);
  });

  it('should return the original string if no asset tags are present', () => {
    const input = 'This is a normal sentence.';
    expect(stripAssetTags(input)).toBe(input);
  });

  it('should handle empty strings', () => {
    expect(stripAssetTags('')).toBe('');
  });

  it('should handle null or undefined input', () => {
    expect(stripAssetTags(null)).toBe('');
    expect(stripAssetTags(undefined)).toBe('');
  });

  it('should trim whitespace after removing tags', () => {
    const input = '[ASSET:npc:balthazar]   Lots of space.   ';
    const expected = 'Lots of space.';
    expect(stripAssetTags(input)).toBe(expected);
  });

  it('should handle strings with only asset tags', () => {
    const input = '[ASSET:type:id1] [ASSET:type:id2]';
    expect(stripAssetTags(input)).toBe('');
  });
});
