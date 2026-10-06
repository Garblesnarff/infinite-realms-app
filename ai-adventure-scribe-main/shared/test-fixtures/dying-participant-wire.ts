/**
 * A dying player as the server serves it to the client: one participant of
 * `CombatEncounterService.getCombatState` (and so of the `combat_state_updated` broadcast and the
 * active-combat read), captured from the real producer after a spider put The Scholar at 0/7 and
 * struck the body with an automatic critical hit (two failures, none saved).
 *
 * Shared on purpose: the real-database suite `dying-and-death.real-db.test.ts` asserts the real
 * `getCombatState` produces exactly these keys and these death-save values, and the client tests
 * (`authoritative-combat-state`, the dying panel) read this same object. A fixture that left out a
 * field the server always sets is how #2349 shipped inert; this one cannot drift without the
 * server test failing. The ids are stable placeholders; every other key is the producer's.
 */
export const DYING_SCHOLAR_ENCOUNTER = {
  id: '91b38a2f-69f1-4aed-8118-b45fabb79f6a',
  sessionId: 'c5cf5d5b-d489-4274-bd7e-2d7934cca101',
  status: 'active',
  endedReason: null,
  currentRound: 3,
  currentTurnOrder: 0,
  version: 3,
  pendingIntent: null,
  location: null,
  difficulty: null,
  experienceAwarded: null,
  startedAt: '2026-10-05T23:43:11.584Z',
  endedAt: null,
  createdAt: '2026-10-05T23:43:11.584Z',
  updatedAt: '2026-10-05T23:43:11.971Z',
} as const;

export const DYING_SCHOLAR_PARTICIPANT = {
  id: '9d5872f0-8ab8-44aa-afad-2eea3f23ca49',
  encounterId: '91b38a2f-69f1-4aed-8118-b45fabb79f6a',
  characterId: '01029f3b-1ece-4c52-bb0b-1ad7add8696b',
  npcId: null,
  name: 'The Scholar',
  participantType: 'player',
  initiative: 15,
  initiativeModifier: 0,
  turnOrder: 0,
  isActive: true,
  armorClass: 11,
  maxHp: 7,
  speed: 30,
  resourcesRound: 3,
  actionUsed: false,
  bonusActionUsed: false,
  reactionUsed: false,
  isDodging: false,
  isDisengaged: false,
  provoked: false,
  damageResistances: [],
  damageImmunities: [],
  damageVulnerabilities: [],
  multiclassInfo: null,
  monsterAttack: null,
  createdAt: '2026-10-05T23:43:11.586Z',
  updatedAt: '2026-10-05T23:43:11.972Z',
  status: {
    id: '9d4865a9-bd08-4b1c-9692-24724ecb82fe',
    participantId: '9d5872f0-8ab8-44aa-afad-2eea3f23ca49',
    currentHp: 0,
    maxHp: 7,
    tempHp: 0,
    isConscious: false,
    deathSavesSuccesses: 0,
    deathSavesFailures: 2,
    exhaustionLevel: 0,
    updatedAt: '2026-10-05T23:43:11.925Z',
  },
  conditions: [],
  vitalState: 'dying',
} as const;
