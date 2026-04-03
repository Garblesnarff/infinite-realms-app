import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createStagger, createFade, respectReducedMotion } from '../animations/utilities';

describe('Animation Utilities', () => {
  describe('createStagger', () => {
    it('should create a stagger animation with default values', () => {
      const result = createStagger();
      expect(result.hidden).toEqual({ opacity: 0 });
      expect(result.visible).toEqual({
        opacity: 1,
        transition: {
          staggerChildren: 0.1,
          delayChildren: 0,
        },
      });
    });

    it('should create a stagger animation with custom values', () => {
      const result = createStagger(0.2, 0.5);
      expect(result.visible.transition).toEqual({
        staggerChildren: 0.2,
        delayChildren: 0.5,
      });
    });
  });

  describe('createFade', () => {
    it('should create a fade animation with no direction', () => {
      const result = createFade('none');
      expect(result.hidden).toEqual({ opacity: 0, y: 0 });
      expect(result.visible.opacity).toBe(1);
    });

    it('should create a fade animation for "up"', () => {
      const result = createFade('up', 20);
      expect(result.hidden.y).toBe(20); // Starts below (y: 20), moves to 0. Animate UP.
    });

    it('should create a fade animation for "down"', () => {
      const result = createFade('down', 20);
      expect(result.hidden.y).toBe(-20); // Starts above (y: -20), moves to 0. Animate DOWN.
    });

    it('should create a fade animation for "left"', () => {
      const result = createFade('left', 20);
      expect(result.hidden.x).toBe(20); // Starts right (x: 20), moves to 0. Animate LEFT.
    });

    it('should create a fade animation for "right"', () => {
      const result = createFade('right', 20);
      expect(result.hidden.x).toBe(-20); // Starts left (x: -20), moves to 0. Animate RIGHT.
    });
  });

  describe('respectReducedMotion', () => {
    beforeEach(() => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockReturnValue({ matches: false }),
      });
    });

    it('should return original variants if reduced motion is disabled', () => {
      const variants = {
        hidden: { opacity: 0, x: -100 },
        visible: { opacity: 1, x: 0 },
      };
      const result = respectReducedMotion(variants);
      expect(result).toEqual(variants);
    });

    it('should return simplified variants if reduced motion is enabled', () => {
      vi.stubGlobal('window', {
        matchMedia: vi.fn().mockImplementation((query) => ({
          matches: query === '(prefers-reduced-motion: reduce)',
        })),
      });

      const variants = {
        hidden: { opacity: 0, x: -100 },
        visible: { opacity: 1, x: 0 },
      };
      const result = respectReducedMotion(variants);
      expect(result.hidden).toEqual({ opacity: 0 });
      expect(result.visible).toEqual({ opacity: 1, transition: { duration: 0.01 } });
      expect((result.visible as any).x).toBeUndefined();
    });
  });
});
