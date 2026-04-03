import { ParticleQuality } from '../types';

/**
 * Quality multipliers for particle counts
 */
export const QUALITY_MULTIPLIERS: Record<ParticleQuality, number> = {
  [ParticleQuality.LOW]: 0.3,
  [ParticleQuality.MEDIUM]: 0.6,
  [ParticleQuality.HIGH]: 1.0,
};

/**
 * Adjusts particle count based on quality setting
 */
export function adjustForQuality(baseCount: number, quality: ParticleQuality): number {
  return Math.max(1, Math.floor(baseCount * QUALITY_MULTIPLIERS[quality]));
}
