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

/**
 * Run 17 (#2415): the sheet's Cast button on Chill Touch, out of combat, near Captain Sarah
 * Reeves. `buildSpellCastMessage` writes this exact line (a client test asserts it); it names no
 * creature, and its comma used to split the clause so the pre-DM check never saw a spell.
 */
export const SHEET_CAST_PLAYER_INPUT =
  'I cast Chill Touch [spell_id=chill-touch, spell_level=cantrip].';

/** The last DM message of run 17: Reeves is named; "The Unseen Shadow" is only mood. */
export const SHEET_CAST_RECENT_NARRATION =
  'Captain Sarah Reeves approaches behind you, her lantern guttering. Below, shadows that do not cast light shift along the shaft.';

/** What `loadCombatIntentActorRoster` returns for a session that has met these two: ledger NPCs. */
export const sheetCastRoster = [
  { name: 'Captain Sarah Reeves', source: 'ledger' as const },
  { name: 'Professor Emil Darkwater', source: 'ledger' as const },
];

/**
 * Run 18 (#2445): a fresh Abyssal Descent session, nothing met yet, so every actor is one the
 * loader read from the campaign's authored cast (`npcs` rows and starter-campaign chunks).
 * `"Iron" Jawn` is the campaign's own spelling, quotes included.
 */
export const abyssalRoster = [
  { name: '"Iron" Jawn', actorSlug: 'iron-jawn', source: 'campaign' as const },
  {
    name: 'Professor Emil Darkwater',
    actorSlug: 'professor-emil-darkwater',
    source: 'campaign' as const,
  },
  { name: 'Captain Sarah Reeves', actorSlug: 'captain-sarah-reeves', source: 'campaign' as const },
];

/** Run 18's last DM message names Reeves, and has "iron" in it: a rail, not a man. */
export const ABYSSAL_RECENT_NARRATION =
  'Captain Sarah Reeves grips the iron rail and peers into the chasm. "What we will find is failure," she says.';

/**
 * Run 19 (#2458): the same session with "Mother Basalt", a campaign NPC nobody had met, on the
 * roster. The loader gives her `source: 'campaign'`.
 */
export const run19Roster = [
  ...abyssalRoster,
  { name: 'Mother Basalt', actorSlug: 'mother-basalt', source: 'campaign' as const },
];

/** Names Reeves in full; "basalt" and "mother" are cave and trinket words, not Mother Basalt. */
export const RUN19_RECENT_NARRATION =
  'Captain Sarah Reeves holds her lantern high. The basalt walls glisten with damp, like mother of pearl.';

export const sheetCastCheckBody = {
  playerInput: SHEET_CAST_PLAYER_INPUT,
  player: declaredAttackCheckBody.player,
  recentNarration: SHEET_CAST_RECENT_NARRATION,
};
