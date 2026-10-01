/**
 * Claims of harm in DM narration, for turns the engine resolved nothing for (#2342, #2373).
 *
 * Shared because two places must agree on what counts: the client gate that rejects a reply
 * (`src/hooks/ai/narration-gate.ts`) and the server, which must not write a provisional copy of
 * a reply the client is about to reject (`dm-reply-persistence.ts`, #2218). Pure text in, phrases
 * out; no imports.
 *
 * Every pattern needs a cue that the harm lands on the player or is the engine's arithmetic
 * ("hit points", "4 damage"): a bare `hit`, `strike` or `wounded` is also "the smell hits you",
 * "lightning strikes the tower" and "a wounded soldier", and a false positive costs a
 * regeneration now that the check is enforced.
 */

const ATTACK_NOUN = 'strike|blow|attack|swing|slash|stab|lunge|hit|bite|claw|punch|kick|thrust';
const ATTACK_VERB =
  'strikes?|struck|striking|hits?|hitting|slash(?:es|ed)|stab(?:s|bed)|lash(?:es|ed)|bites?|bit|' +
  'claw(?:s|ed)|club(?:s|bed)|smash(?:es|ed)|slam(?:s|med)|punch(?:es|ed)|kick(?:s|ed)|' +
  'pierc(?:es|ed)|graz(?:es|ed)|clips?|clipped|scorch(?:es|ed)|singe[sd]?';
const CONDITION = 'poisoned|paraly[sz]ed|unconscious|petrified|incapacitated|restrained|grappled';
const INJURY = 'wounded|injured|bloodied|bleeding|hurt';
/** What a creature hurts with: "the claw catches you", "the claws rake across your ribs". */
const NATURAL_WEAPON = 'claws?|talons?|fangs?|teeth|nails?|blade|dagger|fist|horns?|tail';

const HARM_PATTERNS: RegExp[] = [
  // "it strikes you", "hits your shoulder", "attacks you". The only capture group is a leading
  // "you", the player as the subject ("you strike your foe"), which is skipped below. "strikes
  // your blade against the anvil" is someone using the player's blade, not hitting the player.
  new RegExp(
    `(\\byou\\s+)?\\b(?:${ATTACK_VERB}|attacks?|attacked|lunges?|lunged)\\s+(?:at\\s+)?(?:you|yourself|your\\s+\\w+)\\b(?!\\s+against\\b)`,
    'gi',
  ),
  // "a strike from the entity", "an attack by the guard".
  new RegExp(
    `\\b(?:${ATTACK_NOUN})s?\\s+(?:from|by)\\s+(?:the|its|his|her|their|a|an)\\s+\\w+`,
    'gi',
  ),
  // "you narrowly avoid a strike": the attack is asserted even as it is dodged.
  new RegExp(
    `\\b(?:avoid|dodge|evade|duck|sidestep|parry|deflect|block|slip)\\w*\\s+(?:\\w+\\s+){0,3}?(?:${ATTACK_NOUN})s?\\b`,
    'gi',
  ),
  // "a glancing blow still leaves you rattled".
  /\b(?:blow|strike|hit|attack|slash|stab|lunge|swing)s?\b[^.!?,;:]{0,40}?\b(?:leaves?|leaving|catches?|catching|clips?|grazes?|glances? off)\s+you\b/gi,
  // "the claw catches you", "the claws rake across your ribs".
  new RegExp(`\\b(?:${NATURAL_WEAPON})\\s+(?:\\w+\\s+)?catch(?:es)?\\s+you\\b`, 'gi'),
  new RegExp(
    `\\b(?:${NATURAL_WEAPON})\\s+(?:rake|rakes|raked|tear|tears|tore|rip|rips|ripped|gouge|gouges|gouged|score|scores|scored)\\b[^.!?]{0,30}\\byour\\b`,
    'gi',
  ),
  // "blood runs down your arm".
  /\bblood\s+(?:runs?|trickles?|streams?|pours?|wells?|drips?|seeps?|flows?|spills?)\b[^.!?]{0,30}\b(?:your|you)\b/gi,
  // Wounds need the player as the one wounded: "wounds you", "you are wounded", "leaves you
  // feeling rattled and wounded". "You see a wounded soldier" and "You notice the bleeding stag"
  // name someone else's injury, so a copula or a "leaves you" construction is required.
  /\bwound(?:s|ed|ing)?\s+you\b/gi,
  new RegExp(
    `\\byou(?:['’]re|\\s+are|\\s+were|\\s+feel|\\s+felt|\\s+look|\\s+remain|\\s+grow|\\s+become|\\s+get|\\s+got)\\s+(?:\\w+\\s+){0,2}?(?:wounded|injured|bloodied|bleeding)\\b`,
    'gi',
  ),
  /\byou(?:['’]re|\s+are|\s+were|\s+get|\s+got)\s+hurt\b/gi,
  new RegExp(`\\b(?:leaves?|leaving|left)\\s+you\\s+(?:[\\w'’-]+\\s+){0,4}?(?:${INJURY})\\b`, 'gi'),
  /\byou\s+(?:stagger|stumble|reel|recoil|lurch)\w*\b[^.!?]{0,25}\b(?:hurt|wounded|bleeding)\b/gi,
  // "you feel a searing pain".
  /\byou\s+(?:feel|felt)\s+(?:an?\s+)?(?:\w+\s+){0,2}?(?:pain|agony)\b/gi,
  // "hit points", "HP", "4 points of damage", "you take damage".
  /\bhit points?\b|\bhp\b|\b\d+\s+(?:points?\s+of\s+)?(?:[a-z]+\s+)?damage\b/gi,
  /\b(?:take|takes|took|suffer|suffers|suffered|deal|deals|dealt)\s+(?:[a-z]+\s+){0,2}damage\b/gi,
  // "you are poisoned", "leaves you paralyzed", "knocked prone".
  new RegExp(
    `\\b(?:you|you['’]re|leaves?\\s+you|leaving\\s+you)\\s+(?:(?:are|be|feel|feeling|now|suddenly|become|becoming|remain|still)\\s+)*(?:${CONDITION})\\b`,
    'gi',
  ),
  /\bknocked\s+(?:you\s+)?(?:prone|unconscious|down)\b/gi,
];

/** The player casting or striking, which only a turn where the player did nothing can fabricate. */
const PLAYER_ACT_PATTERN = /\byour spell\b/gi;

/** "the smell hits you", "rain hits your face": a verb of impact with a subject that is no attacker. */
const FIGURATIVE_SUBJECT =
  /\b(?:smell|scent|stench|odou?r|aroma|reek|wave|heat|cold|chill|gust|wind|breeze|draft|rain|hail|snow|sleet|spray|mist|fog|smoke|steam|dust|sand|ash|sunlight|moonlight|realization|fatigue|exhaustion|silence|weight|sound|noise|glare|light|memory|nausea|dizziness|warmth)\s+(?:of\s+[\w-]+\s+)?$/i;

const NEGATOR = /\b(?:no|not|never|without|nor|neither|cannot)\b|n['’]t\b/i;
/** "Nothing hits you" negates; "Nothing stops the goblin as it hits you" does not. */
const ADJACENT_NEGATOR = /\b(?:nothing|none)\b/i;
/** A negation does not reach across these: "does not respond, but its strike hits you". */
const CLAUSE_BREAK = /[,;:]|\b(?:but|though|although|yet|however)\b/i;

/** "no damage was dealt", "does not strike you", "without any hit": the DM honouring the note. */
function isNegated(text: string, index: number, matched: string): boolean {
  if (NEGATOR.test(matched)) return true;
  const sentenceStart = Math.max(
    text.lastIndexOf('.', index - 1),
    text.lastIndexOf('!', index - 1),
    text.lastIndexOf('?', index - 1),
  );
  const clause =
    text
      .slice(sentenceStart + 1, index)
      .split(CLAUSE_BREAK)
      .pop() ?? '';
  const words = clause.trim().split(/\s+/);
  return (
    NEGATOR.test(words.slice(-6).join(' ')) || ADJACENT_NEGATOR.test(words.slice(-2).join(' '))
  );
}

/**
 * The harm the DM text asserts for a turn the engine resolved nothing for, as the matched
 * phrases (empty when the text is clean). `playerMayHaveActed` is for a turn outside combat,
 * where "your spell lights the corridor" is the player's own action narrated; on a combat turn
 * the player did nothing, so a spell of theirs is invented.
 */
export function fabricatedOutcomeClaims(
  text: string | null | undefined,
  { playerMayHaveActed = false }: { playerMayHaveActed?: boolean } = {},
): string[] {
  const source = text ?? '';
  const patterns = playerMayHaveActed ? HARM_PATTERNS : [...HARM_PATTERNS, PLAYER_ACT_PATTERN];
  const claims = new Set<string>();
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const index = match.index ?? 0;
      const matched = match[0];
      if (match[1]) continue;
      if (isNegated(source, index, matched)) continue;
      if (FIGURATIVE_SUBJECT.test(source.slice(Math.max(0, index - 40), index))) continue;
      claims.add(matched.trim().toLowerCase().slice(0, 80));
    }
  }
  return [...claims].slice(0, 5);
}

export function suspectsFabricatedOutcome(
  text: string | null | undefined,
  options?: { playerMayHaveActed?: boolean },
): boolean {
  return fabricatedOutcomeClaims(text, options).length > 0;
}
