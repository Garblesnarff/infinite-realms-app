/**
 * Combat Attack Service - Re-export Shim
 *
 * This file preserves backward compatibility for existing imports.
 * The actual implementation has been decomposed into server-bun/src/services/combat/:
 * - hit-check.ts: checkHit(), checkAutoCrit()
 * - damage-calculator.ts: calculateDamage(), resolveCriticalHit(), rollDamageDice()
 * - resistance-resolver.ts: aggregateResistances()
 * - data-access.ts: DB queries (getParticipantWithStats, getCreatureStats, etc.)
 * - combat-attack-service.ts: Orchestrator (resolveAttack, resolveSpellAttack)
 *
 * @module server/services/combat-attack-service
 */
export { CombatAttackService, combatAttackService } from './combat/combat-attack-service.js';
