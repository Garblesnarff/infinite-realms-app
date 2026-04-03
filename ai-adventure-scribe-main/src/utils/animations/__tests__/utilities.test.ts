import { describe, it, expect, vi } from 'vitest';

import { createStagger, createFade, respectReducedMotion } from '../utilities';

describe('animation utilities', () => {
  describe('createStagger', () => {
    it('should create stagger variants with default values', () => {
      const variants = createStagger();
      expect(variants.hidden).toEqual({ opacity: 0 });
      expect(variants.visible).toEqual({
        opacity: 1,
        transition: {
          staggerChildren: 0.1,
          delayChildren: 0,
        },
      });
    });

    it('should create stagger variants with custom values', () => {
      const variants = createStagger(0.2, 0.5);
      expect(variants.visible.transition).toEqual({
        staggerChildren: 0.2,
        delayChildren: 0.5,
      });
    });
  });

  describe('createFade', () => {
    it('should create fade variants with no direction', () => {
      const variants = createFade('none');
      expect(variants.hidden).toEqual({ opacity: 0, y: 0 });
      expect(variants.visible.opacity).toBe(1);
      expect(variants.visible.y).toBe(0);
    });

    it('should create fade up variants', () => {
      const variants = createFade('up', 50);
      expect(variants.hidden).toEqual({ opacity: 0, y: 50 });
      expect(variants.visible.y).toBe(0);
    });

    it('should create fade down variants', () => {
      const variants = createFade('down', 50);
      expect(variants.hidden).toEqual({ opacity: 0, y: -50 });
      expect(variants.visible.y).toBe(0);
    });

    it('should create fade left variants', () => {
      const variants = createFade('left', 30);
      expect(variants.hidden).toEqual({ opacity: 0, x: 30 });
      expect(variants.visible.x).toBe(0);
    });

    it('should create fade right variants', () => {
      const variants = createFade('right', 30);
      expect(variants.hidden).toEqual({ opacity: 0, x: -30 });
      expect(variants.visible.x).toBe(0);
    });
  });

  describe('respectReducedMotion', () => {
    it('should return original variants when reduced motion is not preferred', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
      });

      const variants = { hidden: { opacity: 0 }, visible: { opacity: 1 } };
      const result = respectReducedMotion(variants);
      expect(result).toBe(variants);
    });

    it('should return simplified variants when reduced motion is preferred', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockReturnValue({ matches: true }),
      });

      const variants = { hidden: { opacity: 0, x: 100 }, visible: { opacity: 1, x: 0 } };
      const result = respectReducedMotion(variants);
      expect(result.hidden).toEqual({ opacity: 0 });
      expect(result.visible.opacity).toBe(1);
      expect(result.visible.transition).toEqual({ duration: 0.01 });
      expect(result.visible.x).toBeUndefined();
    });

    it('should handle SSR environment (no window)', () => {
      vi.stubGlobal('window', undefined);

      const variants = { hidden: { opacity: 0 }, visible: { opacity: 1 } };
      const result = respectReducedMotion(variants);
      expect(result).toBe(variants);
    });
  });
});
