/**
 * Particle System Utilities
 *
 * Provides reusable particle system configurations for spell effects,
 * combat animations, and environmental effects.
 *
 * Performance-optimized with configurable quality settings.
 *
 * @module utils/particle-systems
 */

import * as THREE from 'three';

import { createFireParticles, createIceParticles, createLightningParticles } from './particles/factories/elemental';
import { createBloodParticles, createSmokeParticles } from './particles/factories/environmental';
import { createHealingParticles, createNecroticParticles, createPoisonParticles, createRadiantParticles } from './particles/factories/magic';
import { getParticleSystem, ParticleSystemRegistry, type ParticleSystemType } from './particles/registry';
import { ParticleQuality, type ParticleAppearance, type ParticleBehavior, type ParticleSystemConfig } from './particles/types';

// Re-export types
export {
  ParticleQuality,
  type ParticleBehavior,
  type ParticleAppearance,
  type ParticleSystemConfig,
  type ParticleSystemType,
};

// Re-export factories
export {
  createFireParticles,
  createIceParticles,
  createLightningParticles,
  createHealingParticles,
  createPoisonParticles,
  createNecroticParticles,
  createRadiantParticles,
  createSmokeParticles,
  createBloodParticles,
};

// Re-export registry
export { ParticleSystemRegistry, getParticleSystem };

// ===========================
// Utility Functions
// ===========================

/**
 * Creates a random velocity within a range
 */
export function randomInRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Creates a random color from an array
 */
export function randomColor(colors: string[]): THREE.Color {
  const colorString = colors[Math.floor(Math.random() * colors.length)];
  return new THREE.Color(colorString);
}

/**
 * Calculates particle opacity based on lifetime progress
 */
export function calculateParticleOpacity(
  age: number,
  lifetime: number,
  baseOpacity: number,
  fadeIn: number = 0,
  fadeOut: number = 0,
): number {
  const progress = age / lifetime;

  // Fade in
  if (progress < fadeIn) {
    return baseOpacity * (progress / fadeIn);
  }

  // Fade out
  if (progress > 1 - fadeOut) {
    return baseOpacity * ((1 - progress) / fadeOut);
  }

  return baseOpacity;
}

/**
 * Calculates particle scale based on lifetime progress
 */
export function calculateParticleScale(
  age: number,
  lifetime: number,
  startScale: number,
  endScale: number,
): number {
  const progress = age / lifetime;
  return startScale + (endScale - startScale) * progress;
}

// ===========================
// Exports
// ===========================

export default {
  createFireParticles,
  createIceParticles,
  createLightningParticles,
  createHealingParticles,
  createPoisonParticles,
  createNecroticParticles,
  createRadiantParticles,
  createSmokeParticles,
  createBloodParticles,
  getParticleSystem,
  ParticleSystemRegistry,
};
