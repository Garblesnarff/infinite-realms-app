/**
 * #913: a Hetzner fair-test turn — the player declares an attack on Head Chef
 * Balthazar, the DM answers with a combat-entry envelope, and the bodies that follow
 * from it. (Ids are synthetic; the prod session's id stays out of this public repo.)
 *
 * Shared on purpose (AGENTS.md §4, the #2286 pattern). The client test asserts the
 * headless client sends exactly `headlessEntryEnterBody` to
 * `POST /v1/combat/sessions/:id/enter`; the server tests post that same body through
 * the real route.
 *
 * Producers: `headlessEntryPending` is what `applyCombatEntryGate` serializes into the
 * generate envelope after `detectCombatEntry` accepts the model's
 * `combat_transition: "start"` (trigger/detail as in the prod
 * `COMBAT_ENTRY_DETECTED_PENDING_PLAYER_ENTRY` line, participants = 2 counting the
 * player), with the `declaredAttack` `detectDeclaredAttack` derives from the player's
 * line (weaponStated included, #877). `headlessEntryEnterResponse` is the `/enter`
 * route's 201 body (`enterResponse` over the seat outcome, `first_action` as
 * `deriveFirstAction` returns it).
 */

export const HEADLESS_ENTRY_SESSION_ID = '00000000-0000-4000-8000-000000000001';
export const HEADLESS_ENTRY_ENCOUNTER_ID = '00000000-0000-4000-8000-000000000002';
export const HEADLESS_ENTRY_CHARACTER_ID = '00000000-0000-4000-8000-000000000003';

export const HEADLESS_ENTRY_PLAYER_INPUT = 'I attack Head Chef Balthazar with my longsword.';

/** The character record the client holds. Only the fields a participant row needs are sent. */
export const headlessEntryCharacter = {
  id: HEADLESS_ENTRY_CHARACTER_ID,
  name: 'Rook',
  currentHitPoints: 12,
  maxHitPoints: 12,
  abilityScores: { dexterity: { modifier: 2 } },
};

/**
 * The sanitized scene the gate hands out with the pending entry: the scene-spec
 * sanitizer's output shape (no `id` — the server discards the model's; environment
 * and placement from its closed unions).
 */
export const headlessEntrySceneSpec = {
  sessionId: HEADLESS_ENTRY_SESSION_ID,
  environment: 'tavern',
  size: 'medium',
  sceneDescription: 'A steamy kitchen; Balthazar blocks the pass with a cleaver in hand.',
  seed: 7,
  enemyPlacement: 'guarding',
};

/** What `detectDeclaredAttack` puts on the pending for the player's line (see header). */
export const headlessEntryDeclaredAttack = {
  verb: 'attack',
  actorName: 'Head Chef Balthazar',
  attackSource: 'weapon',
  weaponStated: true,
  weaponName: 'longsword',
};

/** The `combat_entry_pending` the generate envelope carries after the gate rewrites it. */
export const headlessEntryPending = {
  trigger: 'combat_transition' as const,
  detail: 'combat_transition="start"',
  combatants: [{ name: 'Head Chef Balthazar', count: 1 }],
  sceneSpec: headlessEntrySceneSpec,
  sceneSpecSynthesized: false,
  declaredAttack: headlessEntryDeclaredAttack,
};

/**
 * What `AIService.chatWithDM` hands the client for that turn: the DM's telegraph prose,
 * the transition already rewritten to 'none' by the gate, the pending handoff, and the
 * initiative roll request the model attached to its start envelope.
 */
export const headlessEntryDmResponse = {
  text: 'Balthazar raises his cleaver as you lunge. Roll initiative!',
  combat_transition: 'none' as const,
  combat_entry_pending: headlessEntryPending,
  roll_requests: [
    {
      type: 'initiative',
      formula: '1d20+dex',
      purpose: 'Initiative',
      dc: null,
      ac: null,
      advantage: false,
      disadvantage: false,
    },
  ],
  combat_actions: [],
  map_actions: [],
};

/** The natural d20 the client rolls for the entry (the dice stub in the client test). */
export const HEADLESS_ENTRY_INITIATIVE_ROLL = 14;

/**
 * `POST /v1/combat/sessions/:id/enter`, sent when the client seats the pending entry:
 * the pending's combatants/scene/declaredAttack forwarded verbatim, the player built by
 * `buildCombatEntryPlayer` from `headlessEntryCharacter`, and the rolled d20.
 */
export const headlessEntryEnterBody = {
  combatants: headlessEntryPending.combatants,
  sceneSpec: headlessEntrySceneSpec,
  player: {
    characterId: HEADLESS_ENTRY_CHARACTER_ID,
    name: 'Rook',
    initiativeModifier: 2,
    hpCurrent: 12,
    hpMax: 12,
  },
  declaredAttack: headlessEntryDeclaredAttack,
  playerInitiativeRoll: HEADLESS_ENTRY_INITIATIVE_ROLL,
};

const headlessEntryParticipants = [
  {
    id: 'participant-player',
    name: 'Rook',
    initiative: 16,
    initiativeModifier: 2,
    characterId: HEADLESS_ENTRY_CHARACTER_ID,
    turnOrder: 0,
  },
  {
    id: 'participant-balthazar',
    name: 'Head Chef Balthazar',
    initiative: 11,
    initiativeModifier: 1,
    turnOrder: 1,
  },
];

/** The `/enter` route's 201 body for that seat (see header). */
export const headlessEntryEnterResponse = {
  encounter: { id: HEADLESS_ENTRY_ENCOUNTER_ID },
  participants: headlessEntryParticipants,
  participantSizes: {},
  turnOrder: [
    { participant: headlessEntryParticipants[0], isCurrent: true, hasGone: false },
    { participant: headlessEntryParticipants[1], isCurrent: false, hasGone: false },
  ],
  currentParticipant: headlessEntryParticipants[0],
  initiativeOrder: [
    { id: 'participant-player', name: 'Rook', initiative: 16, isCurrent: true },
    { id: 'participant-balthazar', name: 'Head Chef Balthazar', initiative: 11, isCurrent: false },
  ],
  seatingTranscript:
    '⚙️ Engine: Initiative: 16 (nat 14+2) — You: 14 + 2 = 16 (you rolled). Head Chef Balthazar: 10 + 1 = 11.',
  first_action: {
    type: 'attack',
    actor: 'participant-player',
    actorLabel: 'Rook',
    target: 'participant-balthazar',
    targetLabel: 'Head Chef Balthazar',
    source: 'weapon',
    attackSource: 'weapon',
    weaponId: 'longsword',
    weaponName: 'Longsword',
    spellId: null,
    slotLevel: null,
    combat_action: {
      actor_id: 'participant-player',
      action_type: 'attack',
      target_ids: ['participant-balthazar'],
      weapon_id: 'longsword',
      spell_id: null,
      slot_level: null,
      movement_feet: 0,
    },
    roll_request: {
      type: 'attack',
      formula: '1d20+5',
      purpose: 'Longsword attack against Head Chef Balthazar',
      dc: null,
      ac: 12,
      advantage: false,
      disadvantage: false,
      modifier: 5,
      actorName: 'Rook',
    },
  },
};
