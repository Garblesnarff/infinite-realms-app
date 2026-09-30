/**
 * Run 14's turn 6 (#2341): "I cast Chill Touch at Valerius" typed with no encounter open, and the
 * two bodies the client sends because of it.
 *
 * Shared on purpose (AGENTS.md §4, the #2286 pattern). The client test asserts the client sends
 * exactly `declaredAttackCheckBody` to `POST /v1/combat/sessions/:id/declared-attack` and, after
 * "Do something else", a `/v1/llm/generate` body shaped like `declinedTurnBody`. The server tests
 * post those same bodies through the real routes.
 */

export const DECLARED_ATTACK_SESSION_ID = 'd3d075ef-fec7-4442-b684-c5c35084f41e';

export const DECLARED_ATTACK_PLAYER_INPUT =
  'I do not trust him. I cast Chill Touch at Valerius on the ceiling.';

/** The character record the client holds. Only the fields a participant row needs are sent. */
export const declaredAttackCharacter = {
  id: '25c51574-4316-45f1-825e-aa7f64c03a51',
  name: 'The Scholar',
  currentHitPoints: 7,
  maxHitPoints: 7,
  abilityScores: { dexterity: { modifier: 1 } },
};

/** `POST /v1/combat/sessions/:id/declared-attack`, sent before the DM is called. */
export const declaredAttackCheckBody = {
  playerInput: DECLARED_ATTACK_PLAYER_INPUT,
  player: {
    characterId: declaredAttackCharacter.id,
    name: 'The Scholar',
    initiativeModifier: 1,
    hpCurrent: 7,
    hpMax: 7,
  },
};

/**
 * What `POST /v1/llm/generate` carries after the player declined: the session and the player's
 * words, and no `combatEntry`. With it the server would detect the same attack and ask again.
 */
export const declinedTurnBody = {
  sessionId: DECLARED_ATTACK_SESSION_ID,
  player_input: DECLARED_ATTACK_PLAYER_INPUT,
};

/**
 * "I cast Fire Bolt at him": a known attack spell with no creature the roster can name. The
 * client sends the last DM message so the server can offer the creatures "him" can mean...
 */
export const UNTARGETED_SPELL_PLAYER_INPUT = 'I cast Fire Bolt at him.';

export const RECENT_NARRATION =
  'Valerius the Upside Down drops from the ceiling. Professor Darkwater stammers behind you.';

export const untargetedSpellCheckBody = {
  playerInput: UNTARGETED_SPELL_PLAYER_INPUT,
  player: declaredAttackCheckBody.player,
  recentNarration: RECENT_NARRATION,
};

/** ...and, once the player picks one, asks again with that creature named. */
export const pickedTargetCheckBody = { ...untargetedSpellCheckBody, targetName: 'Valerius' };
