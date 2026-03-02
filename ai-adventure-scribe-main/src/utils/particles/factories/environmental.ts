import * as THREE from 'three';

import { adjustForQuality } from './base';
import { ParticleQuality, type ParticleSystemConfig } from '../types';

/**
 * Creates a smoke particle system configuration
 * Gray smoke with upward drift
 */
export function createSmokeParticles(
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  return {
    id: 'smoke',
    name: 'Smoke',
    particleCount: adjustForQuality(60, quality),
    spawnRate: 25,
    loop: true,
    spawnRadius: 0.2,
    quality,
    behavior: {
      velocityRange: {
        x: [-0.1, 0.1],
        y: [-0.1, 0.1],
        z: [0.2, 0.5],
      },
      acceleration: {
        x: 0,
        y: 0,
        z: 0.15,
      },
      lifetime: 3.5,
      fadeIn: 0.5,
      fadeOut: 0.7,
      rotationSpeed: [-Math.PI * 0.1, Math.PI * 0.1],
      scaleOverTime: {
        start: 0.5,
        end: 2.0,
      },
    },
    appearance: {
      colors: ['#696969', '#808080', '#a9a9a9', '#c0c0c0', '#d3d3d3'],
      size: 0.5,
      sizeVariation: 0.6,
      opacity: 0.4,
      blending: THREE.NormalBlending,
      shape: 'circle',
    },
  };
}

/**
 * Creates a blood particle system configuration
 * Red droplets with downward motion (for damage effects)
 */
export function createBloodParticles(
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  return {
    id: 'blood',
    name: 'Blood',
    particleCount: adjustForQuality(50, quality),
    spawnRate: 100,
    loop: false, // One-shot effect
    spawnRadius: 0.2,
    quality,
    behavior: {
      velocityRange: {
        x: [-0.5, 0.5],
        y: [-0.5, 0.5],
        z: [0.1, 0.5],
      },
      acceleration: {
        x: 0,
        y: 0,
        z: -2.0, // Strong gravity
      },
      lifetime: 1.0,
      fadeIn: 0.0,
      fadeOut: 0.3,
      scaleOverTime: {
        start: 1.0,
        end: 0.5,
      },
    },
    appearance: {
      colors: ['#8b0000', '#a52a2a', '#dc143c', '#b22222'],
      size: 0.15,
      sizeVariation: 0.4,
      opacity: 0.8,
      blending: THREE.NormalBlending,
      shape: 'circle',
    },
  };
}
