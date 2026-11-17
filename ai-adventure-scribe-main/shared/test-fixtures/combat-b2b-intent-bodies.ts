/**
 * The intents the #621 B2b handlers send to `POST /v1/combat/:encounterId/intent`.
 *
 * Shared on purpose (AGENTS.md §4). Two groups:
 *  - `*ClientIntent`: what the handler passes to `executeAuthoritativeCombatIntent`. The client
 *    tests assert the handler passes exactly these.
 *  - `*WireBody`: the body the executor posts. The real-route test posts exactly these bodies.
 *    Player-sourced intents carry the encounter version the executor fetched before posting.
 *
 * The executor serialises `{ intent, source, dmStartedAt, origin }`. `dmStartedAt` is a clock
 * reading, so the fixtures leave it out and the tests compare everything else.
 */

export const B2B_ENCOUNTER_ID = '3232069e-0000-4000-8000-0000000000b2';
export const B2B_ENCOUNTER_VERSION = 4;
/** The DM's monster: the actor of an enemy attack. */
export const B2B_ENEMY_ID = 'e7e569df-0000-4000-8000-0000000000e1';
/** The player participant whose turn it is. */
export const B2B_PLAYER_ID = 'e7e569df-0000-4000-8000-0000000000a1';

// --- Enemy attack: DM-sourced, no version needed (the server is the sequencer). ---

export const enemyAttackClientIntent = {
  type: 'attack' as const,
  actorId: B2B_ENEMY_ID,
  targetId: B2B_PLAYER_ID,
};

export const enemyAttackWireBody = {
  intent: enemyAttackClientIntent,
  source: 'dm' as const,
  origin: 'typed' as const,
};

// --- Player action bar: player-sourced, the executor fills expectedVersion. ---

export const dashClientIntent = { type: 'dash' as const, actorId: B2B_PLAYER_ID };
export const dodgeClientIntent = { type: 'dodge' as const, actorId: B2B_PLAYER_ID };
export const hideClientIntent = {
  type: 'check' as const,
  actorId: B2B_PLAYER_ID,
  checkKind: 'hide' as const,
};
export const grappleClientIntent = {
  type: 'check' as const,
  actorId: B2B_PLAYER_ID,
  targetId: B2B_ENEMY_ID,
  checkKind: 'grapple' as const,
};
export const shoveClientIntent = {
  type: 'check' as const,
  actorId: B2B_PLAYER_ID,
  targetId: B2B_ENEMY_ID,
  checkKind: 'shove' as const,
};

/** The body on the wire for a player action: the client intent plus the version the executor read. */
export const playerActionWireBody = (intent: Record<string, unknown>) => ({
  intent: { ...intent, expectedVersion: B2B_ENCOUNTER_VERSION },
  source: 'player' as const,
  origin: 'action_bar' as const,
});

// --- Fighter features: the same DM-sourced body the DM panel's options post (#975). ---

export const secondWindClientIntent = { type: 'second_wind' as const, actorId: B2B_PLAYER_ID };
export const actionSurgeClientIntent = { type: 'action_surge' as const, actorId: B2B_PLAYER_ID };

export const featureWireBody = (intent: Record<string, unknown>) => ({
  intent,
  source: 'dm' as const,
  origin: 'typed' as const,
});

export const divineSenseClientIntent = { type: 'divine_sense' as const, actorId: B2B_PLAYER_ID };
