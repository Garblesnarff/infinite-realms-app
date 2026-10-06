/**
 * Engine results as the server hands them to the client, one per card case (#2417).
 *
 * Each object copies the full output of its real producer, including the fields the producer
 * always sets, so a card is never tested against a thinner object than production sends:
 *
 * - Weapon attacks: the two returns of `CombatAttackService.resolveAttack`
 *   (`combat-attack-service.ts`, the miss and the hit), then `exposeAttackVisibility`
 *   (`combat-intent-service.ts`), which adds the ids, the names and `weaponResolution`.
 * - Spells: the returns of `CombatAttackService.resolveSpell` (auto-hit Magic Missile, the attack
 *   roll, the save), then `exposeAttackVisibility`'s spell twin, which adds the same names.
 * - Movement only: `decideAttackApproach` (`combat-approach-service.ts`).
 * - Death saves: `mergeBoundaryDeathSaves` (`npc-turn-runner.ts`) over `DeathSaveResult`.
 * - Hits on a downed player (#2518): `resolveAttack` with `deathSaveFailureFields` and, for a melee
 *   blow within 5 ft on an unconscious target, `autoCritOnDowned`; instant death sets `instantDeath`.
 *
 * Names are the display names the card prints; ids are the engine's.
 */

export const SCHOLAR = { id: 'player-1', name: 'The Scholar' };
export const REEVES = { id: 'npc-1', name: 'Captain Sarah Reeves' };

/**
 * The roster `rosterEntryForParticipant` builds for a fight between the two. The client types every
 * non-player participant `monster` (`mapAuthoritativeCombat`).
 */
export const FIGHT_ROSTER = [
  { id: SCHOLAR.id, name: SCHOLAR.name, participantType: 'player' },
  { id: REEVES.id, name: REEVES.name, participantType: 'monster' },
];

const rawHit = {
  hit: true,
  d20: 14,
  attackBonus: 0,
  targetAC: 11,
  baseAc: 11,
  coverBonus: 0,
  cover: null,
  totalAttackRoll: 14,
  damage: 3,
  damageType: 'slashing',
  damageBeforeResistances: 3,
  effectiveResistance: false,
  effectiveVulnerability: false,
  effectiveImmunity: false,
  finalDamage: 3,
  targetNewHp: 4,
  targetIsConscious: true,
  targetIsDead: false,
  targetCondition: 'wounded',
  isCritical: false,
  isNaturalOne: false,
  isNaturalTwenty: false,
  autoRolled: false,
};

const rawMiss = {
  hit: false,
  d20: 5,
  attackBonus: 0,
  targetAC: 11,
  baseAc: 11,
  coverBonus: 0,
  cover: null,
  totalAttackRoll: 5,
  effectiveResistance: false,
  effectiveVulnerability: false,
  effectiveImmunity: false,
  finalDamage: 0,
  isCritical: false,
  isNaturalOne: false,
  isNaturalTwenty: false,
  autoRolled: false,
};

type Combatant = { id: string; name: string };

/** `exposeAttackVisibility`: the ids, the names and the weapon, laid over the raw result. */
const exposed = (
  raw: Record<string, unknown>,
  actor: Combatant,
  target: Combatant,
  weapon = 'Longsword',
) => ({
  ...raw,
  actorId: actor.id,
  actorName: actor.name,
  targetId: target.id,
  targetName: target.name,
  weaponResolution: { requested: weapon, resolved: weapon, substituted: false },
});

/** The action the client sent for each result. */
export const attackAction = (actor: Combatant, target: Combatant) => ({
  actor_id: actor.id,
  action_type: 'attack' as const,
  target_ids: [target.id],
});

export const spellAction = (actor: Combatant, target: Combatant) => ({
  actor_id: actor.id,
  action_type: 'cast_spell' as const,
  target_ids: [target.id],
});

export const PLAYER_HITS_ENEMY = exposed(
  {
    ...rawHit,
    targetNewHp: 9,
    targetCondition: 'bloodied',
    attackBonus: 4,
    totalAttackRoll: 18,
    targetAC: 13,
    baseAc: 13,
  },
  SCHOLAR,
  REEVES,
);
export const PLAYER_MISSES_ENEMY = exposed(rawMiss, SCHOLAR, REEVES);
export const PLAYER_CRITS_ENEMY = exposed(
  {
    ...rawHit,
    d20: 20,
    totalAttackRoll: 20,
    damage: 8,
    finalDamage: 8,
    isCritical: true,
    isNaturalTwenty: true,
  },
  SCHOLAR,
  REEVES,
);
export const ENEMY_HITS_PLAYER = exposed(rawHit, REEVES, SCHOLAR);
export const ENEMY_MISSES_PLAYER = exposed(rawMiss, REEVES, SCHOLAR);
export const ENEMY_CRITS_PLAYER = exposed(
  {
    ...rawHit,
    d20: 20,
    totalAttackRoll: 20,
    damage: 6,
    finalDamage: 6,
    targetNewHp: 1,
    isCritical: true,
    isNaturalTwenty: true,
  },
  REEVES,
  SCHOLAR,
);
/** Half cover: seated AC 12, the roll is judged against 14. */
export const PLAYER_HITS_BEHIND_COVER = exposed(
  { ...rawHit, targetAC: 14, baseAc: 12, coverBonus: 2, cover: 1, totalAttackRoll: 14 },
  SCHOLAR,
  REEVES,
);
export const ENEMY_SWAPS_WEAPON = {
  ...exposed(rawMiss, REEVES, SCHOLAR, 'Longsword'),
  weaponResolution: { requested: 'Greatsword', resolved: 'Longsword', substituted: true },
};
export const ENEMY_MOVES_WITHOUT_ATTACKING = {
  resolvedAs: 'movement_only',
  actorId: REEVES.id,
  targetId: SCHOLAR.id,
  movedFeet: 30,
  distanceFeet: 10,
  reachFeet: 5,
  from: { x: 0, y: 0 },
  to: { x: 6, y: 0 },
  startingDistanceFeet: 40,
  movementRemainingFeet: 0,
  movementAvailableFeet: 30,
  pathCostFeet: 30,
  reason: 'out_of_reach_after_full_movement',
  refusalReason: 'out_of_reach',
  narrative: 'Captain Sarah Reeves could not reach The Scholar.',
  actorName: REEVES.name,
  targetName: SCHOLAR.name,
  weaponResolution: { requested: 'Longsword', resolved: 'Longsword', substituted: false },
};

const spellExposed = (raw: Record<string, unknown>, actor: Combatant, target: Combatant) => ({
  ...raw,
  actorId: actor.id,
  actorName: actor.name,
  targetId: target.id,
  targetName: target.name,
});

/** Chill Touch: a spell attack roll. */
export const PLAYER_SPELL_ATTACK_HITS = spellExposed(
  {
    ...rawHit,
    attackBonus: 6,
    totalAttackRoll: 20,
    d20: 14,
    damage: 5,
    finalDamage: 5,
    damageType: 'necrotic',
    targetNewHp: 9,
    targetCondition: 'bloodied',
    spellName: 'Chill Touch',
  },
  SCHOLAR,
  REEVES,
);
export const PLAYER_SPELL_ATTACK_MISSES = spellExposed(
  { ...rawMiss, attackBonus: 6, d20: 2, totalAttackRoll: 8, spellName: 'Chill Touch' },
  SCHOLAR,
  REEVES,
);
/** Magic Missile: no roll, `autoHit`, AC reported but unused. */
export const PLAYER_MAGIC_MISSILE = spellExposed(
  {
    hit: true,
    targetAC: 13,
    baseAc: 13,
    coverBonus: 0,
    cover: null,
    totalAttackRoll: 0,
    damage: 7,
    damageType: 'force',
    damageBeforeResistances: 7,
    effectiveResistance: false,
    effectiveVulnerability: false,
    effectiveImmunity: false,
    finalDamage: 7,
    targetNewHp: 5,
    targetIsConscious: true,
    targetIsDead: false,
    targetCondition: 'bloodied',
    isCritical: false,
    isNaturalOne: false,
    isNaturalTwenty: false,
    autoHit: true,
    spellName: 'Magic Missile',
  },
  SCHOLAR,
  REEVES,
);
const saveResult = (saved: boolean, finalDamage: number) => ({
  hit: !saved,
  targetAC: 0,
  totalAttackRoll: 6,
  damage: 2,
  damageType: 'acid',
  damageBeforeResistances: 2,
  effectiveResistance: false,
  effectiveVulnerability: false,
  effectiveImmunity: false,
  finalDamage,
  targetNewHp: 9,
  targetIsConscious: true,
  targetIsDead: false,
  targetCondition: 'bloodied',
  isCritical: false,
  isNaturalOne: false,
  isNaturalTwenty: false,
  spellName: 'Acid Splash',
  saveAbility: 'dexterity',
  saveRoll: saved ? 17 : 6,
  saveDC: 14,
  saved,
});
export const ENEMY_FAILS_SAVE = spellExposed(saveResult(false, 2), SCHOLAR, REEVES);
export const ENEMY_SAVES = spellExposed(saveResult(true, 0), SCHOLAR, REEVES);
/** An enemy's save spell that the player fails: the player's own HP is on the card. */
export const ENEMY_SAVE_SPELL_HITS_PLAYER = spellExposed(
  { ...saveResult(false, 3), targetNewHp: 4, spellName: 'Fire Bolt' },
  REEVES,
  SCHOLAR,
);
/** Cure Wounds: `{hit: true, finalDamage: 0}` with no damage type. */
export const PLAYER_HEALS_ALLY = spellExposed(
  {
    hit: true,
    targetAC: 0,
    totalAttackRoll: 0,
    finalDamage: 0,
    targetNewHp: 12,
    targetIsConscious: true,
    targetIsDead: false,
    isCritical: false,
    isNaturalOne: false,
    isNaturalTwenty: false,
    spellName: 'Cure Wounds',
  },
  SCHOLAR,
  SCHOLAR,
);

/** `DeathSaveResult` for a failed save (the second failure). */
/**
 * A melee blow within 5 ft on an unconscious player (#2518): `resolveAttack` returns an automatic
 * critical hit, two failures (the tally after them: 2 of 3), and says so with `autoCritOnDowned`.
 */
export const ENEMY_STRIKES_DOWNED_PLAYER = exposed(
  {
    ...rawHit,
    d20: 2,
    totalAttackRoll: 2,
    damage: 6,
    finalDamage: 6,
    targetNewHp: 0,
    targetIsConscious: false,
    targetIsDead: false,
    targetCondition: 'near death',
    isCritical: true,
    autoCritOnDowned: true,
    deathSaveFailuresAdded: 2,
    deathSavesFailures: 2,
  },
  REEVES,
  SCHOLAR,
);

/**
 * A ranged hit on an unconscious player: one failure, no automatic critical (`autoCritOnDowned`
 * is absent, as `resolveAttack` leaves it).
 */
export const ENEMY_SHOOTS_DOWNED_PLAYER = exposed(
  {
    ...rawHit,
    damage: 2,
    finalDamage: 2,
    targetNewHp: 0,
    targetIsConscious: false,
    targetIsDead: false,
    targetCondition: 'near death',
    deathSaveFailuresAdded: 1,
    deathSavesFailures: 1,
  },
  REEVES,
  SCHOLAR,
);

/** A critical on a player with 1 HP whose overflow reached the maximum: instant death. */
export const ENEMY_INSTANT_KILLS_PLAYER = exposed(
  {
    ...rawHit,
    d20: 20,
    totalAttackRoll: 20,
    damage: 22,
    finalDamage: 22,
    targetNewHp: 0,
    targetIsConscious: false,
    targetIsDead: true,
    targetCondition: 'near death',
    isCritical: true,
    isNaturalTwenty: true,
    instantDeath: true,
  },
  REEVES,
  SCHOLAR,
);

export const DEATH_SAVE_FAILED = {
  participantId: SCHOLAR.id,
  roll: 6,
  isSuccess: false,
  isCritical: false,
  successes: 0,
  failures: 2,
  isStabilized: false,
  isDead: false,
  wasRevived: false,
  newCurrentHp: 0,
};
export const DEATH_SAVE_PASSED = {
  ...DEATH_SAVE_FAILED,
  roll: 14,
  isSuccess: true,
  successes: 1,
  failures: 1,
};
