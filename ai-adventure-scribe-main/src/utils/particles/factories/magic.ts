import * as THREE from 'three';

import { adjustForQuality } from './base';
import { ParticleQuality, type ParticleSystemConfig } from '../types';

/**
 * Creates a healing particle system configuration
 * Green/gold sparkles with gentle upward motion
 */
export function createHealingParticles(
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  return {
    id: 'healing',
    name: 'Healing',
    particleCount: adjustForQuality(70, quality),
    spawnRate: 35,
    loop: true,
    spawnRadius: 0.5,
    quality,
    behavior: {
      velocityRange: {
        x: [-0.2, 0.2],
        y: [-0.2, 0.2],
        z: [0.3, 0.8],
      },
      acceleration: {
        x: 0,
        y: 0,
        z: 0.1,
      },
      lifetime: 2.5,
      fadeIn: 0.3,
      fadeOut: 0.4,
      rotationSpeed: [-Math.PI * 0.3, Math.PI * 0.3],
      scaleOverTime: {
        start: 0.8,
        end: 1.2,
      },
    },
    appearance: {
      colors: ['#00ff00', '#32cd32', '#98fb98', '#ffd700', '#ffff00'],
      size: 0.15,
      sizeVariation: 0.3,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      shape: 'circle',
    },
  };
}

/**
 * Creates a poison particle system configuration
 * Green miasma with slow, spreading motion
 */
export function createPoisonParticles(
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  return {
    id: 'poison',
    name: 'Poison',
    particleCount: adjustForQuality(90, quality),
    spawnRate: 30,
    loop: true,
    spawnRadius: 0.3,
    quality,
    behavior: {
      velocityRange: {
        x: [-0.15, 0.15],
        y: [-0.15, 0.15],
        z: [-0.1, 0.2],
      },
      acceleration: {
        x: 0,
        y: 0,
        z: 0.05,
      },
      lifetime: 3.0,
      fadeIn: 0.4,
      fadeOut: 0.5,
      rotationSpeed: [-Math.PI * 0.2, Math.PI * 0.2],
      scaleOverTime: {
        start: 0.5,
        end: 1.5,
      },
    },
    appearance: {
      colors: ['#228b22', '#2e8b57', '#3cb371', '#00ff00', '#7fff00'],
      size: 0.4,
      sizeVariation: 0.5,
      opacity: 0.5,
      blending: THREE.NormalBlending,
      shape: 'circle',
    },
  };
}

/**
 * Creates a necrotic particle system configuration
 * Dark purple/black wisps with eerie movement
 */
export function createNecroticParticles(
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  return {
    id: 'necrotic',
    name: 'Necrotic',
    particleCount: adjustForQuality(85, quality),
    spawnRate: 40,
    loop: true,
    spawnRadius: 0.4,
    quality,
    behavior: {
      velocityRange: {
        x: [-0.25, 0.25],
        y: [-0.25, 0.25],
        z: [-0.3, 0.3],
      },
      acceleration: {
        x: 0,
        y: 0,
        z: -0.1,
      },
      lifetime: 2.2,
      fadeIn: 0.3,
      fadeOut: 0.6,
      rotationSpeed: [-Math.PI * 0.4, Math.PI * 0.4],
      scaleOverTime: {
        start: 1.0,
        end: 0.5,
      },
    },
    appearance: {
      colors: ['#4b0082', '#8b008b', '#9400d3', '#483d8b', '#2f4f4f'],
      size: 0.35,
      sizeVariation: 0.4,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      shape: 'circle',
    },
  };
}

/**
 * Creates a radiant particle system configuration
 * Bright white/yellow light particles
 */
export function createRadiantParticles(
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  return {
    id: 'radiant',
    name: 'Radiant',
    particleCount: adjustForQuality(75, quality),
    spawnRate: 45,
    loop: true,
    spawnRadius: 0.3,
    quality,
    behavior: {
      velocityRange: {
        x: [-0.4, 0.4],
        y: [-0.4, 0.4],
        z: [0.2, 0.6],
      },
      acceleration: {
        x: 0,
        y: 0,
        z: 0.2,
      },
      lifetime: 1.8,
      fadeIn: 0.1,
      fadeOut: 0.4,
      rotationSpeed: [-Math.PI, Math.PI],
      scaleOverTime: {
        start: 1.2,
        end: 0.4,
      },
    },
    appearance: {
      colors: ['#ffffff', '#fffacd', '#ffffe0', '#fafad2', '#ffd700'],
      size: 0.2,
      sizeVariation: 0.3,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      shape: 'circle',
    },
  };
}
