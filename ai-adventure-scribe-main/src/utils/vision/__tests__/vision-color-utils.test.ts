import { describe, it, expect } from 'vitest';

import { getVisionColor, getVisionOpacity } from '../vision-color-utils';

describe('vision-color-utils', () => {
  describe('getVisionColor', () => {
    it('should return correct colors for various vision modes', () => {
      expect(getVisionColor('basic')).toBe('#ffffff');
      expect(getVisionColor('darkvision')).toBe('#6366f1');
      expect(getVisionColor('monochrome')).toBe('#9ca3af');
      expect(getVisionColor('tremorsense')).toBe('#92400e');
      expect(getVisionColor('blindsight')).toBe('#fbbf24');
      expect(getVisionColor('truesight')).toBe('#fbbf24');
    });

    it('should default to basic color when vision mode is undefined', () => {
      expect(getVisionColor(undefined)).toBe('#ffffff');
    });
  });

  describe('getVisionOpacity', () => {
    it('should return correct opacities for various vision modes', () => {
      expect(getVisionOpacity('basic')).toBe(0.15);
      expect(getVisionOpacity('darkvision')).toBe(0.2);
      expect(getVisionOpacity('monochrome')).toBe(0.2);
      expect(getVisionOpacity('tremorsense')).toBe(0.25);
      expect(getVisionOpacity('blindsight')).toBe(0.3);
      expect(getVisionOpacity('truesight')).toBe(0.35);
    });

    it('should default to basic opacity when vision mode is undefined', () => {
      expect(getVisionOpacity(undefined)).toBe(0.15);
    });
  });
});
