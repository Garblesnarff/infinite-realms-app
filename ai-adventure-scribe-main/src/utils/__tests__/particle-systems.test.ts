import * as THREE from 'three';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  randomInRange,
  randomColor,
  calculateParticleOpacity,
  calculateParticleScale,
} from '../particle-systems';
import { getParticleSystem, ParticleSystemRegistry } from '../particles/registry';
import { ParticleQuality } from '../particles/types';

describe('particle-systems utilities', () => {
  describe('randomInRange', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return the minimum value when Math.random is 0', () => {
      vi.mocked(Math.random).mockReturnValue(0);
      expect(randomInRange(10, 20)).toBe(10);
    });

    it('should return the maximum value when Math.random is almost 1', () => {
      vi.mocked(Math.random).mockReturnValue(0.999999);
      expect(randomInRange(10, 20)).toBeCloseTo(20);
    });

    it('should return the midpoint when Math.random is 0.5', () => {
      vi.mocked(Math.random).mockReturnValue(0.5);
      expect(randomInRange(10, 20)).toBe(15);
    });
  });

  describe('randomColor', () => {
    beforeEach(() => {
      vi.spyOn(Math, 'random');
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should select a color from the array and return a THREE.Color', () => {
      const colors = ['#ff0000', '#00ff00', '#0000ff'];

      // Select first color
      vi.mocked(Math.random).mockReturnValue(0);
      let color = randomColor(colors);
      expect(color).toBeInstanceOf(THREE.Color);
      expect(color.getHexString()).toBe('ff0000');

      // Select last color
      vi.mocked(Math.random).mockReturnValue(0.99);
      color = randomColor(colors);
      expect(color.getHexString()).toBe('0000ff');
    });
  });

  describe('calculateParticleOpacity', () => {
    const baseOpacity = 0.8;
    const lifetime = 2.0;

    it('should return baseOpacity when no fade is specified', () => {
      expect(calculateParticleOpacity(1.0, lifetime, baseOpacity)).toBe(baseOpacity);
    });

    it('should handle fade in', () => {
      const fadeIn = 0.2; // First 20% of lifetime
      // At 10% progress
      expect(calculateParticleOpacity(0.2, lifetime, baseOpacity, fadeIn)).toBe(baseOpacity * 0.5);
      // At 20% progress (end of fade in)
      expect(calculateParticleOpacity(0.4, lifetime, baseOpacity, fadeIn)).toBe(baseOpacity);
    });

    it('should handle fade out', () => {
      const fadeOut = 0.2; // Last 20% of lifetime
      // At 90% progress
      expect(calculateParticleOpacity(1.8, lifetime, baseOpacity, 0, fadeOut)).toBeCloseTo(baseOpacity * 0.5);
      // At 100% progress
      expect(calculateParticleOpacity(2.0, lifetime, baseOpacity, 0, fadeOut)).toBeCloseTo(0);
    });

    it('should return baseOpacity in the middle of fade in and fade out', () => {
      expect(calculateParticleOpacity(1.0, lifetime, baseOpacity, 0.2, 0.2)).toBe(baseOpacity);
    });
  });

  describe('calculateParticleScale', () => {
    it('should interpolate scale linearly', () => {
      const startScale = 1.0;
      const endScale = 2.0;
      const lifetime = 10;

      expect(calculateParticleScale(0, lifetime, startScale, endScale)).toBe(1.0);
      expect(calculateParticleScale(5, lifetime, startScale, endScale)).toBe(1.5);
      expect(calculateParticleScale(10, lifetime, startScale, endScale)).toBe(2.0);
    });
  });

  describe('getParticleSystem', () => {
    it('should return a valid configuration for all registered types', () => {
      const types = Object.keys(ParticleSystemRegistry) as (keyof typeof ParticleSystemRegistry)[];

      types.forEach(type => {
        const config = getParticleSystem(type, ParticleQuality.HIGH);
        expect(config).toBeDefined();
        expect(config.id).toBe(type);
        expect(config.quality).toBe(ParticleQuality.HIGH);
        expect(config.behavior).toBeDefined();
        expect(config.appearance).toBeDefined();
      });
    });

    it('should adjust particle count based on quality', () => {
      const fireHigh = getParticleSystem('fire', ParticleQuality.HIGH);
      const fireLow = getParticleSystem('fire', ParticleQuality.LOW);

      expect(fireLow.particleCount).toBeLessThan(fireHigh.particleCount);
      expect(fireLow.quality).toBe(ParticleQuality.LOW);
    });
  });
});
