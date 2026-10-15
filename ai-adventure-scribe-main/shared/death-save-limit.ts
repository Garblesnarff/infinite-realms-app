/**
 * 5E: three failures kill, three successes stabilise (SRD 5.1).
 *
 * Lives in shared/ because both the character-vitals service and the combat HP
 * mechanics need the same threshold, and the vitals service must not depend on
 * the combat graph — combat depends on it (#621).
 */
export const DEATH_SAVE_LIMIT = 3;
