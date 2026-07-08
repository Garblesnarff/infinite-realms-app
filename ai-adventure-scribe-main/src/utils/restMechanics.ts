/**
 * Pure rest helper re-exports.
 *
 * Character-mutating rest state is owned by the server rest API. Keep this
 * module free of local short/long-rest mutation logic so UI state cannot drift
 * from persisted character state.
 */

export { recoverExhaustion } from './rest/exhaustion';
export { calculateMaxHitDice, rollHitDice, recoverHitDice } from './rest/hit-dice';
