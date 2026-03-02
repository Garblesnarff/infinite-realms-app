import * as THREE from 'three';

import { adjustForQuality } from './base';
import { ParticleQuality, type ParticleSystemConfig } from '../types';

/**
 * Creates a fire particle system configuration
 * Orange/red particles with upward motion
 */
export function createFireParticles(
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  return {
    id: 'fire',
    name: 'Fire',
    particleCount: adjustForQuality(100, quality),
    spawnRate: 50,
    loop: true,
    spawnRadius: 0.3,
    quality,
    behavior: {
      velocityRange: {
        x: [-0.2, 0.2],
        y: [-0.2, 0.2],
        z: [0.5, 1.5], // Upward
      },
      acceleration: {
        x: 0,
        y: 0,
        z: 0.3, // Slight upward acceleration
      },
      lifetime: 1.5,
      fadeIn: 0.1,
      fadeOut: 0.3,
      rotationSpeed: [-Math.PI, Math.PI],
      scaleOverTime: {
        start: 1.0,
        end: 0.3,
      },
    },
    appearance: {
      colors: ['#ff4500', '#ff6347', '#ff8c00', '#ffa500', '#ffff00'],
      size: 0.3,
      sizeVariation: 0.4,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      shape: 'circle',
    },
  };
}

/**
 * Creates an ice particle system configuration
 * Blue/white crystalline particles
 */
export function createIceParticles(
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  return {
    id: 'ice',
    name: 'Ice',
    particleCount: adjustForQuality(80, quality),
    spawnRate: 40,
    loop: true,
    spawnRadius: 0.4,
    quality,
    behavior: {
      velocityRange: {
        x: [-0.3, 0.3],
        y: [-0.3, 0.3],
        z: [-0.5, 0.1], // Slight downward bias
      },
      acceleration: {
        x: 0,
        y: 0,
        z: -0.2, // Gravity
      },
      lifetime: 2.0,
      fadeIn: 0.2,
      fadeOut: 0.4,
      rotationSpeed: [-Math.PI * 0.5, Math.PI * 0.5],
      scaleOverTime: {
        start: 0.5,
        end: 1.0,
      },
    },
    appearance: {
      colors: ['#87ceeb', '#add8e6', '#b0e0e6', '#e0ffff', '#f0f8ff'],
      size: 0.25,
      sizeVariation: 0.5,
      opacity: 0.7,
      blending: THREE.AdditiveBlending,
      shape: 'spark',
    },
  };
}

/**
 * Creates a lightning particle system configuration
 * Electric blue sparks with rapid motion
 */
export function createLightningParticles(
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  return {
    id: 'lightning',
    name: 'Lightning',
    particleCount: adjustForQuality(60, quality),
    spawnRate: 80,
    loop: true,
    spawnRadius: 0.2,
    quality,
    behavior: {
      velocityRange: {
        x: [-1.5, 1.5],
        y: [-1.5, 1.5],
        z: [-1.5, 1.5],
      },
      acceleration: {
        x: 0,
        y: 0,
        z: 0,
      },
      lifetime: 0.5, // Short, rapid bursts
      fadeIn: 0.0,
      fadeOut: 0.5,
      rotationSpeed: [-Math.PI * 2, Math.PI * 2],
      scaleOverTime: {
        start: 1.0,
        end: 0.2,
      },
    },
    appearance: {
      colors: ['#00bfff', '#1e90ff', '#4169e1', '#0000ff', '#ffffff'],
      size: 0.2,
      sizeVariation: 0.6,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      shape: 'spark',
    },
  };
}
