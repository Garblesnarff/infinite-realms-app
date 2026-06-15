import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { stripAssetTags, throttle, cn } from './utils';

describe('cn', () => {
  it('should merge tailwind classes correctly', () => {
    expect(cn('bg-red-500', 'text-white')).toBe('bg-red-500 text-white');
    expect(cn('px-2 py-1', 'p-4')).toBe('p-4');
  });

  it('should handle conditional classes', () => {
    const isTrue = true;
    const isFalse = false;
    expect(cn('base', isTrue && 'true-class', isFalse && 'false-class')).toBe('base true-class');
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should execute immediately on the first call (leading edge)', () => {
    const func = vi.fn();
    const throttled = throttle(func, 100);

    throttled('first');

    expect(func).toHaveBeenCalledTimes(1);
    expect(func).toHaveBeenCalledWith('first');
  });

  it('should ignore subsequent calls within the wait period', () => {
    const func = vi.fn();
    const throttled = throttle(func, 100);

    throttled('first');
    throttled('second');
    throttled('third');

    expect(func).toHaveBeenCalledTimes(1);
    expect(func).toHaveBeenCalledWith('first');
  });

  it('should execute the last call after the wait period (trailing edge)', () => {
    const func = vi.fn();
    const throttled = throttle(func, 100);

    throttled('first');
    throttled('second');
    throttled('third');

    expect(func).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);

    expect(func).toHaveBeenCalledTimes(2);
    expect(func).toHaveBeenLastCalledWith('third');
  });

  it('should allow leading edge again after wait period', () => {
    const func = vi.fn();
    const throttled = throttle(func, 100);

    throttled('first');
    vi.advanceTimersByTime(100); // Trailing edge would execute here if there was a call
    expect(func).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(50); // More time passes

    throttled('second');
    expect(func).toHaveBeenCalledTimes(2);
    expect(func).toHaveBeenLastCalledWith('second');
  });

  it('should immediately execute pending call when flushed', () => {
    const func = vi.fn();
    const throttled = throttle(func, 100);

    throttled('first');
    throttled('second');
    expect(func).toHaveBeenCalledTimes(1);

    throttled.flush();

    expect(func).toHaveBeenCalledTimes(2);
    expect(func).toHaveBeenLastCalledWith('second');
  });

  it('should not execute on flush if no call is pending', () => {
    const func = vi.fn();
    const throttled = throttle(func, 100);

    throttled('first');
    expect(func).toHaveBeenCalledTimes(1);

    throttled.flush();

    expect(func).toHaveBeenCalledTimes(1);
  });

  it('should correctly reset after flush', () => {
    const func = vi.fn();
    const throttled = throttle(func, 100);

    throttled('first');
    throttled('second');
    throttled.flush();
    expect(func).toHaveBeenCalledTimes(2);

    // After flush, we should be able to call immediately again as if the timer just finished
    // Actually, the implementation sets lastCallTime = Date.now() in flush.
    // So if we call it immediately after flush, it should be throttled.
    throttled('third');
    expect(func).toHaveBeenCalledTimes(2); // Throttled

    vi.advanceTimersByTime(100);
    expect(func).toHaveBeenCalledTimes(3);
    expect(func).toHaveBeenLastCalledWith('third');
  });
});

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
