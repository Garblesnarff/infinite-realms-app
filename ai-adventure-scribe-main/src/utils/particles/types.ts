import type * as THREE from 'three';

/**
 * Performance quality settings
 */
export enum ParticleQuality {
  LOW = 'low', // Minimal particles, simple effects
  MEDIUM = 'medium', // Balanced quality/performance
  HIGH = 'high', // Maximum visual fidelity
}

/**
 * Particle behavior configuration
 */
export interface ParticleBehavior {
  /** Initial velocity range */
  velocityRange: {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };

  /** Acceleration (gravity, wind, etc.) */
  acceleration: {
    x: number;
    y: number;
    z: number;
  };

  /** Particle lifetime in seconds */
  lifetime: number;

  /** Fade in duration (0-1 of lifetime) */
  fadeIn?: number;

  /** Fade out duration (0-1 of lifetime) */
  fadeOut?: number;

  /** Rotation speed range (radians/second) */
  rotationSpeed?: [number, number];

  /** Scale change over time */
  scaleOverTime?: {
    start: number;
    end: number;
  };
}

/**
 * Particle appearance configuration
 */
export interface ParticleAppearance {
  /** Particle colors (will be randomly selected) */
  colors: string[];

  /** Particle size in world units */
  size: number;

  /** Size variation (0-1) */
  sizeVariation: number;

  /** Base opacity */
  opacity: number;

  /** Blending mode */
  blending: THREE.Blending;

  /** Optional texture URL */
  texture?: string;

  /** Shape type */
  shape?: 'square' | 'circle' | 'spark';
}

/**
 * Complete particle system configuration
 */
export interface ParticleSystemConfig {
  /** Unique identifier */
  id: string;

  /** Display name */
  name: string;

  /** Number of particles to spawn */
  particleCount: number;

  /** Particles spawned per second */
  spawnRate: number;

  /** Particle behavior */
  behavior: ParticleBehavior;

  /** Particle appearance */
  appearance: ParticleAppearance;

  /** Whether to loop the effect */
  loop: boolean;

  /** Spawn area radius */
  spawnRadius: number;

  /** Performance quality level */
  quality: ParticleQuality;
}
