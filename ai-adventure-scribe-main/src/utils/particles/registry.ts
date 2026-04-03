import { createFireParticles, createIceParticles, createLightningParticles } from './factories/elemental';
import { createBloodParticles, createSmokeParticles } from './factories/environmental';
import { createHealingParticles, createNecroticParticles, createPoisonParticles, createRadiantParticles } from './factories/magic';
import { ParticleQuality, type ParticleSystemConfig } from './types';

/**
 * Registry of all available particle systems
 */
export const ParticleSystemRegistry = {
  fire: createFireParticles,
  ice: createIceParticles,
  lightning: createLightningParticles,
  healing: createHealingParticles,
  poison: createPoisonParticles,
  necrotic: createNecroticParticles,
  radiant: createRadiantParticles,
  smoke: createSmokeParticles,
  blood: createBloodParticles,
} as const;

export type ParticleSystemType = keyof typeof ParticleSystemRegistry;

/**
 * Gets a particle system configuration by type
 */
export function getParticleSystem(
  type: ParticleSystemType,
  quality: ParticleQuality = ParticleQuality.MEDIUM,
): ParticleSystemConfig {
  const factory = ParticleSystemRegistry[type];
  return factory(quality);
}
