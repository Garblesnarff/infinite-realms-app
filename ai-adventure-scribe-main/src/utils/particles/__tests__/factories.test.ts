import * as THREE from 'three';
import { describe, it, expect } from 'vitest';

import { adjustForQuality, QUALITY_MULTIPLIERS } from '../factories/base';
import { createFireParticles, createIceParticles, createLightningParticles } from '../factories/elemental';
import { createBloodParticles, createSmokeParticles } from '../factories/environmental';
import {
  createHealingParticles,
  createPoisonParticles,
  createNecroticParticles,
  createRadiantParticles,
} from '../factories/magic';
import { ParticleQuality } from '../types';

describe('Particle Factories', () => {
  describe('base (adjustForQuality)', () => {
    it('should correctly adjust particle counts', () => {
      const baseCount = 100;
      expect(adjustForQuality(baseCount, ParticleQuality.LOW)).toBe(
        Math.floor(baseCount * QUALITY_MULTIPLIERS[ParticleQuality.LOW]),
      );
      expect(adjustForQuality(baseCount, ParticleQuality.MEDIUM)).toBe(
        Math.floor(baseCount * QUALITY_MULTIPLIERS[ParticleQuality.MEDIUM]),
      );
      expect(adjustForQuality(baseCount, ParticleQuality.HIGH)).toBe(
        Math.floor(baseCount * QUALITY_MULTIPLIERS[ParticleQuality.HIGH]),
      );
    });

    it('should always return at least 1 particle', () => {
      expect(adjustForQuality(1, ParticleQuality.LOW)).toBeGreaterThanOrEqual(1);
    });
  });

  describe('elemental factories', () => {
    it('should create fire particles with correct configuration', () => {
      const config = createFireParticles(ParticleQuality.HIGH);
      expect(config.id).toBe('fire');
      expect(config.name).toBe('Fire');
      expect(config.appearance.blending).toBe(THREE.AdditiveBlending);
      expect(config.behavior.velocityRange.z[0]).toBeGreaterThan(0); // Upward
      expect(config.quality).toBe(ParticleQuality.HIGH);
    });

    it('should create ice particles with correct configuration', () => {
      const config = createIceParticles(ParticleQuality.MEDIUM);
      expect(config.id).toBe('ice');
      expect(config.appearance.shape).toBe('spark');
      expect(config.quality).toBe(ParticleQuality.MEDIUM);
    });

    it('should create lightning particles with correct configuration', () => {
      const config = createLightningParticles(ParticleQuality.LOW);
      expect(config.id).toBe('lightning');
      expect(config.behavior.lifetime).toBeLessThan(1.0);
      expect(config.quality).toBe(ParticleQuality.LOW);
    });
  });

  describe('magic factories', () => {
    it('should create healing particles', () => {
      const config = createHealingParticles(ParticleQuality.HIGH);
      expect(config.id).toBe('healing');
      expect(config.appearance.colors).toContain('#00ff00');
      expect(config.quality).toBe(ParticleQuality.HIGH);
    });

    it('should create poison particles', () => {
      const config = createPoisonParticles(ParticleQuality.MEDIUM);
      expect(config.id).toBe('poison');
      expect(config.appearance.blending).toBe(THREE.NormalBlending);
      expect(config.quality).toBe(ParticleQuality.MEDIUM);
    });

    it('should create necrotic particles', () => {
      const config = createNecroticParticles(ParticleQuality.LOW);
      expect(config.id).toBe('necrotic');
      expect(config.behavior.acceleration.z).toBeLessThan(0);
      expect(config.quality).toBe(ParticleQuality.LOW);
    });

    it('should create radiant particles', () => {
      const config = createRadiantParticles();
      expect(config.id).toBe('radiant');
      expect(config.appearance.opacity).toBeGreaterThan(0.8);
      expect(config.quality).toBe(ParticleQuality.MEDIUM); // Default
    });
  });

  describe('environmental factories', () => {
    it('should create smoke particles', () => {
      const config = createSmokeParticles();
      expect(config.id).toBe('smoke');
      expect(config.behavior.scaleOverTime?.end).toBeGreaterThan(
        config.behavior.scaleOverTime?.start || 0,
      );
    });

    it('should create blood particles', () => {
      const config = createBloodParticles();
      expect(config.id).toBe('blood');
      expect(config.loop).toBe(false);
      expect(config.behavior.acceleration.z).toBeLessThan(-1); // Gravity
    });
  });
});
