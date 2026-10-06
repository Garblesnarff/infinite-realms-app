/**
 * The live-hostile guard for a DM-declared scene end (#2524).
 *
 * Run D1 ended two of its four fights with `dm_ended_scene` while the monster was still
 * standing — 3/13 and 5/11 HP, conscious and active — and the DM narrated a killing blow
 * the engine never rolled. The engine, not the prose, owns death: combat may not end on
 * the DM's say-so while a hostile participant is conscious and active unless the envelope
 * explicitly declares that participant's non-lethal exit (`fled`, `surrendered`,
 * `withdrew`). An exit is marked as that state — never as dead — and the narration may
 * not describe it as a kill.
 *
 * Pure and dependency-free (following the narration-contract convention) so the rule is
 * unit-testable without a database; `concludeEncounter` and the generation-time
 * enforcement both judge with this one module.
 */

/** The non-lethal exits the DM's envelope may declare for a still-standing hostile. */
export type CombatExitKind = 'fled' | 'surrendered' | 'withdrew';

export type CombatExitDeclaration = {
  /** Participant id (engine id or tactical slug) the declaration names. */
  participant_id: string;
  exit: CombatExitKind;
};

/** The subset of a hydrated combat participant this module reads. */
export interface SceneEndParticipant {
  id: string;
  name?: string | null;
  participantType: string;
  isActive: boolean;
  maxHp?: number;
  /** Authored disposition from NPC stats, when the participant carries one. */
  disposition?: string | null;
  /** Prompt-roster only: this line carries the CURRENT TURN marker. */
  isCurrentTurn?: boolean;
  status?: {
    currentHp: number;
    isConscious: boolean;
  } | null;
}

const EXIT_KINDS: ReadonlySet<string> = new Set(['fled', 'surrendered', 'withdrew']);

export function isCombatExitDeclaration(value: unknown): value is CombatExitDeclaration {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { participant_id?: unknown; exit?: unknown };
  return (
    typeof candidate.participant_id === 'string' &&
    candidate.participant_id.length > 0 &&
    typeof candidate.exit === 'string' &&
    EXIT_KINDS.has(candidate.exit)
  );
}

/** The declarations in an envelope, tolerating a missing or malformed field. */
export function combatExitsOf(value: unknown): CombatExitDeclaration[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isCombatExitDeclaration);
}

/**
 * A hostile that forbids a scene end: still in the turn order, not a player or an
 * ally, above 0 HP and conscious. Mirrors the D1 readout rows (`is_conscious = true`,
 * `is_active = true`). Allied and companion NPCs never block an end.
 */
export function isLiveHostile(participant: SceneEndParticipant): boolean {
  if (!participant.isActive) return false;
  if (participant.participantType === 'player') return false;
  const disposition = (participant.disposition ?? '').toLowerCase();
  if (disposition.includes('ally') || disposition.includes('friend')) return false;
  const currentHp = participant.status?.currentHp ?? participant.maxHp ?? 0;
  if (currentHp <= 0) return false;
  return participant.status?.isConscious !== false;
}

export type SceneEndDecision =
  | { allowed: true; exits: CombatExitDeclaration[] }
  | {
      allowed: false;
      /** Live hostiles no exit declaration accounts for. */
      unaccounted: SceneEndParticipant[];
      exits: CombatExitDeclaration[];
    };

/**
 * Whether the player's side has left the fight entirely — every player and ally participant out
 * of the turn order.
 *
 * A standing hostile blocks a scene end because there is still somebody in the fight for it to
 * hurt. Once the party has left — every player and ally participant out of the turn order —
 * that reason is gone: the creatures are still standing, but nobody is left to be fought, and
 * the fight the guard was protecting is over. The exited party is never written back as dead
 * and never counted as defeated; the encounter simply has no participants left on one side.
 *
 * Callers apply this to the FULL roster and judge `evaluateSceneEnd` on it too. It cannot live
 * inside that judge, because the generation-time caller filters the current-turn line out before
 * judging — and the filtered roster has no player in it on an ordinary turn, so a judge that
 * tested it there would wave every end through.
 */
export function partyHasLeftTheFight(participants: readonly SceneEndParticipant[]): boolean {
  const stillFighting = participants.some((participant) => {
    if (!participant.isActive) return false;
    if (participant.participantType === 'player') return true;
    const disposition = (participant.disposition ?? '').toLowerCase();
    return disposition.includes('ally') || disposition.includes('friend');
  });
  return !stillFighting;
}

/**
 * Judge a DM scene end against the engine's roster. An exit declaration accounts only
 * for the live hostile it names — matched on id or on the slug the DM was shown, since
 * the model addresses participants by slug, never by database id. Declarations naming
 * anyone else (the player, a creature already down) are dropped, not honored.
 */
export function evaluateSceneEnd(
  participants: readonly SceneEndParticipant[],
  exits: readonly CombatExitDeclaration[],
  slugOf: (participant: SceneEndParticipant) => string = (participant) => participant.id,
): SceneEndDecision {
  const liveHostiles = participants.filter(isLiveHostile);
  const honored = exits.filter((declaration) =>
    liveHostiles.some(
      (participant) =>
        participant.id === declaration.participant_id ||
        slugOf(participant) === declaration.participant_id,
    ),
  );
  const accounted = new Set(
    honored.flatMap((declaration) => {
      const match = liveHostiles.find(
        (participant) =>
          participant.id === declaration.participant_id ||
          slugOf(participant) === declaration.participant_id,
      );
      return match ? [match.id] : [];
    }),
  );
  const unaccounted = liveHostiles.filter((participant) => !accounted.has(participant.id));
  return unaccounted.length > 0
    ? { allowed: false, unaccounted, exits: honored }
    : { allowed: true, exits: honored };
}

/** The engine notice for a refused end — the sentence the DM reads on its next turn. */
export function describeSceneEndRefusal(unaccounted: readonly SceneEndParticipant[]): string {
  const names = unaccounted.map((participant) => participant.name || participant.id).join(', ');
  return (
    `COMBAT HAS NOT ENDED: ${names} ${unaccounted.length === 1 ? 'is' : 'are'} still ` +
    'standing, conscious and hostile. The fight continues. Combat can only end while a ' +
    'hostile stands if it fled, surrendered or withdrew — declare that exit; do not ' +
    'narrate a kill the engine did not roll.'
  );
}

/** The engine notice for an accepted non-lethal exit. */
export function describeCombatExit(name: string, exit: CombatExitKind): string {
  const verb = exit === 'fled' ? 'has fled the fight' : exit === 'surrendered' ? 'has surrendered' : 'has withdrawn from the fight';
  return `${name} ${verb}. It is NOT dead.`;
}

const KILL_PHRASE =
  /\b(?:killed|kill|slain|slays?|lifeless|collapses?\s+(?:dead|lifeless)|collapsed\s+(?:dead|lifeless)|finishing\s+blow|final\s+blow|death\s+blow|cleav(?:e|es|ed|ing)(?:\s+through)?|finish(?:es|ed|ing)?|lies?\s+dead|falls?\s+dead|drops?\s+dead|now\s+dead|is\s+dead|dead\s+at\s+(?:your|his|her|their)\s+feet|dissipat\w*|disintegrat\w*)\b/i;

const sentencesOf = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

const nameTokens = (name: string): string[] =>
  name
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((token) => token.length > 3 && !['the', 'of'].includes(token));

const ORDINAL_WORDS = [
  'first',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'eighth',
  'ninth',
  'tenth',
];

/** A kill sentence that opens by pointing back at the last-named creature (#2563). */
const ANAPHORIC_OPENER = /^\s*(?:the\s+(?:creature|monster|beast|thing|fiend|horror|entity)\b|it\b)/i;

/**
 * Whether a sentence names this participant: the whole name or its slug, or a single
 * name token that is unique across the roster — a shared first token ("Goblin" in
 * Goblin Boss / Goblin Archer) names neither.
 */
const nameMentioned = (
  sentence: string,
  participant: SceneEndParticipant,
  roster: readonly SceneEndParticipant[],
): boolean => {
  const lower = sentence.toLowerCase();
  const names = [participant.name, participant.id].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 1,
  );
  if (names.some((name) => lower.includes(name.toLowerCase()))) return true;
  const own = new Set(names.flatMap(nameTokens));
  if (!own.size) return false;
  const shared = new Set(
    roster
      .filter((other) => other.id !== participant.id)
      .flatMap((other) => [other.name ?? '', other.id].flatMap(nameTokens)),
  );
  if ([...own].some((token) => !shared.has(token) && lower.includes(token))) return true;
  // Numbered duplicates (#2563, run D5): "the first Light-Eater" names Light-Eater
  // Swarm 1 even though every name token is shared with Swarm 2. The family stem must
  // appear; an ordinal in the sentence pins the mention to that number, and with no
  // ordinal the mention covers the whole family.
  const family = /^(.*?)[\s-]+(\d+)$/.exec((participant.name ?? '').toLowerCase().trim());
  if (!family) return false;
  const stemTokens = nameTokens(family[1]);
  if (!stemTokens.length || !stemTokens.some((token) => lower.includes(token))) return false;
  const ordinal = ORDINAL_WORDS.findIndex((word) => new RegExp(`\\b${word}\\b`).test(lower));
  return ordinal < 0 || ordinal + 1 === Number(family[2]);
};

export type KillClaim = {
  participantId: string;
  participantName: string;
  sentence: string;
};

/**
 * Kill language about a participant the engine still counts as alive (HP > 0). A claim
 * needs the participant named in the same sentence as the kill phrase — or pointed
 * back at from the sentence before it — so narration about a creature the engine
 * actually felled, or about nobody in the encounter, is not flagged.
 */
export function findKillClaims(
  text: string | null | undefined,
  participants: readonly SceneEndParticipant[],
): KillClaim[] {
  const source = (text ?? '').trim();
  if (!source) return [];
  const alive = participants.filter((participant) => {
    // The player character is never a kill-claim target: "your finishing blow" names
    // the killer, and PC death belongs to the death-save machinery, not this guard.
    if (participant.participantType === 'player') return false;
    const currentHp = participant.status?.currentHp ?? participant.maxHp ?? 0;
    return currentHp > 0;
  });
  if (!alive.length) return [];
  const aliveIds = new Set(alive.map((participant) => participant.id));
  const claims: KillClaim[] = [];
  // Narration points back: "The creature … dissipates" names nobody in its own
  // sentence, but it is the creature the previous sentence named (#2563, run D5). A
  // kill sentence that names no roster participant and opens anaphorically inherits
  // the most recent mention, so a kill cannot hide behind a pronoun.
  let lastMentioned: SceneEndParticipant[] = [];
  for (const sentence of sentencesOf(source)) {
    const mentioned = participants.filter((participant) =>
      nameMentioned(sentence, participant, participants),
    );
    if (mentioned.length) lastMentioned = mentioned;
    if (!KILL_PHRASE.test(sentence)) continue;
    let targets = mentioned.filter((participant) => aliveIds.has(participant.id));
    if (!mentioned.length && ANAPHORIC_OPENER.test(sentence)) {
      targets = lastMentioned.filter((participant) => aliveIds.has(participant.id));
    }
    for (const participant of targets) {
      claims.push({
        participantId: participant.id,
        participantName: participant.name || participant.id,
        sentence,
      });
    }
  }
  return claims;
}

/** Remove the sentences carrying a kill claim, leaving the rest of the narration intact. */
export function stripKillSentences(text: string, claims: readonly KillClaim[]): string {
  if (!claims.length) return text;
  const condemned = new Set(claims.map((claim) => claim.sentence));
  return sentencesOf(text)
    .filter((sentence) => !condemned.has(sentence))
    .join(' ')
    .trim();
}
