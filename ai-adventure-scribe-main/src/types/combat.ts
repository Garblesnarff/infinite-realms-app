/**
 * Combat Types for D&D 5e Tabletop Experience
 *
 * These types represent the core mechanics of D&D 5e combat
 * as they would appear at a physical table, not as a video game.
 * Focus on turn-based mechanics, dice rolls, and DM oversight.
 *
 * Split by domain; this module re-exports everything so consumers can
 * keep importing from '@/types/combat'.
 */

export * from './combat-encounter';
export * from './combat-features';
export * from './combat-mechanics';
export * from './combat-participants';
