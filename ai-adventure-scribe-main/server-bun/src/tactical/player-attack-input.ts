import { findPlayerCombatSpellInText } from '../data/spellData.js';

/**
 * Reads what the PLAYER said they will do this turn (#2641).
 *
 * The prose floor used to read the DM's narration, and the narration of the monsters' turn is full
 * of attack language that is not the player's: run D9 got an attack prompt, for a weapon the
 * player never named, on "I hold my position". With player input present the floor reads only the
 * input, and this is the reader: it cuts out what the player refused, and says whether what is left
 * is a swing or a cast by the player. The text it returns for target, weapon and spell is the
 * declaring clauses only, so a refused creature, weapon or spell is never read.
 */

/** Weapons a player names, shared with the narration reader. */
export const WEAPON_NOUN =
  'blade|sword|longsword|shortsword|greatsword|rapier|scimitar|dagger|axe|greataxe|handaxe|mace|hammer|warhammer|maul|spear|glaive|halberd|pike|quarterstaff|staff|club|flail|whip|bow|longbow|shortbow|crossbow|sling|javelin|dart|bolt|arrow|fangs?|talons?|claws?|mandibles?|pincers?|stinger|weapon';

/** Where one thing the player says ends and the next begins (a refusal's span ends here too). */
const HARD_BREAK = String.raw`[,.;!?|]`;
const SPAN_END = String.raw`(?=${HARD_BREAK}|\s+(?:but|then|and)\b|$)`;
const REST_OF_CLAUSE = String.raw`[^,.;!?|]*?`;

/**
 * What the player will NOT do, or only might do, or is stopping: the marker and the rest of its
 * clause. A refusal removes its own words and nothing else, so "I attack the zombie without
 * mercy", "the zombie that isn't moving" and "no fear" keep their attack, and a name with "and" in
 * it is not cut.
 */
const REFUSED_SPAN = new RegExp(
  [
    String.raw`\b(?:do(?:es)?\s+not|don't|won't|will\s+not|can't|cannot|can\s+not|couldn't|shouldn't|wouldn't|never|refus\w+\s+to|declin\w+\s+to|rather\s+not|(?:decid\w+|choos\w+|chose|try\w*|tried)\s+not\s+to|not\s+(?:to|going\s+to)|decid\w+\s+against|refrain\w*|stop(?:s|ped|ping)?|hold(?:s|ing)?\s+off|hesitat\w+|afraid|keep(?:s|ing)?\s+from|avoid\w*|unable|might|could|should|may|ready\s+an?)\b${REST_OF_CLAUSE}${SPAN_END}`,
    String.raw`\bnot\s+(?:attack|strik|fight|swing|shoot|hit|cast)\w*${REST_OF_CLAUSE}${SPAN_END}`,
    String.raw`\bnot\s+(?:the|a|an|that|this|those|these|him|her|it|them)\b${REST_OF_CLAUSE}${SPAN_END}`,
    String.raw`\bno\s+(?:\w+\s+)?(?:attack|strike|offensive|combat|violence|fight)\w*`,
    String.raw`\b(?:attack|strike|hit|fight)\w*\s+(?:nobody|no\s+one|nothing)\b`,
    String.raw`\bwithout\s+\w+`,
  ].join('|'),
  'gi',
);

/** An "if" is a plan for later, not this turn's swing. */
const CONDITIONAL = /\b(?:if|unless)\b/i;

/** Verbs that mean "strike" whatever else is in the clause. Base and inflected forms. */
const STRONG_VERB = String.raw`(?:attack(?:s|ed|ing)?|strik(?:e|es|ing)|struck|stab(?:s|bed|bing)?|slash(?:es|ed|ing)?|swing(?:s|ing)?|swung|smit(?:e|es|ing)|smote|slay(?:s|ing)?|kill(?:s|ed|ing)?|cleav(?:e|es|ing)|hack(?:s|ed|ing)?|bash(?:es|ed|ing)?|slic(?:e|es|ing)|maul(?:s|ed|ing)?|pounc(?:e|es|ing)|punch(?:es|ed|ing)?|kick(?:s|ed|ing)?|head-?butt(?:s|ed|ing)?|impal(?:e|es|ed|ing)|skewer(?:s|ed|ing)?|jab(?:s|bed|bing)?|thrust(?:s|ing)?|hit(?:s|ting)?|smash(?:es|ed|ing)?|bit(?:e|es|ing)|lash(?:es|ed|ing)?\s+out|slam(?:s|med|ming)?\s+into|go(?:es)?\s+for|finish(?:es|ing)?\s+(?:it|him|her|them)(?:\s+off)?|(?:driv(?:e|es|ing)|plung(?:e|es|ing)|sink(?:s|ing)|bring(?:s|ing)?)\s+(?:\S+\s+){0,3}(?:into|down)|us(?:e|es|ing)\s+(?:my|the|a)\s+(?:\S+\s+){0,2}?(?:${WEAPON_NOUN})\s+(?:on|against|at))`;

/**
 * Verbs that are a strike only when they have an object that can be struck. Melee-ish ones need a
 * creature or a weapon ("I charge the roach", not "I charge toward the stairs"); ranged-ish ones
 * need a weapon or a thing that is not a glance or a rope.
 */
const MELEE_CONTEXTUAL = String.raw`(?:charg(?:e|es|ing)|rush(?:es|ing)?|lung(?:e|es|ing)|shov(?:e|es|ing)|tackl(?:e|es|ing)|grappl(?:e|es|ing)|fight(?:s|ing)?|elbow(?:s|ing)?|slap(?:s|ped|ping)?)`;
const RANGED_CONTEXTUAL = String.raw`(?:throw(?:s|ing)?|threw|hurl(?:s|ing)?|fir(?:e|es|ing)|shoot(?:s|ing)?|shot|launch(?:es|ing)?|loos(?:e|es|ing)|blast(?:s|ing)?|zap(?:s|ped|ping)?)`;

/** The player is the subject, or the clause is an order: "I quickly swing", "Attacking the roach". */
const lead = (verb: string): RegExp =>
  new RegExp(
    String.raw`^(?:(${verb})|(?:\w+\s+){0,2}?(?:i(?:'?(?:m|ll|d|ve))?|we|let'?s)\s+(?!(?:watch|let|help|see|hear|tell|ask|order|command|notice|wait|hope)\b)(?:\S+\s+){0,3}?(${verb}))\b`,
    'i',
  );

const STRONG = lead(STRONG_VERB);
const MELEE = lead(MELEE_CONTEXTUAL);
const RANGED = lead(RANGED_CONTEXTUAL);

/** Dodging, blocking or bracing against an attack is not making one. */
const DEFENSIVE =
  /\b(?:dodg\w*|block\w*|parr\w*|avoid\w*|evad\w*|deflect\w*|brac\w*|duck\w*|flinch\w*|withstand|endure)\b/i;

/** Something is being done TO the player: "I get hit". */
const PASSIVE =
  /\b(?:get|gets|got|getting|am|is|are|was|were|been|being)\s+(?:\w+\s+)?(?:hit|struck|attacked|stabbed|slashed|killed)\b/i;

/** "their attack", "the hit": a noun for what someone else does, not the player's verb. */
const SOMEONE_ELSES =
  /\b(?:their|its|his|her|the|that|this|those|these|incoming)\s+(?:attacks?|strikes?|hits?|blows?)\b/i;

/** "strike a match", "hit the road", "swing the door open": the verb, but not a fight. */
const NOT_A_FIGHT =
  /\b(?:strik\w*|struck|hit\w*|swing\w*|swung|kick\w*|smash\w*|bash\w*)\s+(?:(?:down|open|in)\s+)?(?:a\s+|the\s+|my\s+)?(?:match|pose|deal|bargain|light|chord|road|dirt|deck|brakes|books|hay|sack|ground|door|gate|rope|vine|chandelier|ledge|wall|bell|gong|flint|spark)\b|\b(?:strik\w*|swing\w*|swung|kick\w*)\s+(?:open|across|over|on|from)\b/i;

/** What a ranged verb is thrown or shot that is no attack. */
const NOT_A_PROJECTILE =
  /\b(?:throw\w*|threw|hurl\w*|shoot\w*|shot|fir\w*|launch\w*|loos\w*)\s+(?:a\s+|the\s+|my\s+)?(?:glance|look|stare|smile|wink|coin|rope|kiss|question|torch|flare|signal|up)\b/i;

export interface AttackObjects {
  /** Whether the text names a creature that is hostile to the player on this board. */
  namesHostile: (text: string) => boolean;
  /** Whether the text names a weapon the player holds or an unarmed strike. */
  namesWeapon: (text: string) => boolean;
}

export interface PlayerAttackRead {
  /** Whether the player's words declare a swing or a cast. */
  declared: boolean;
  /** The declaring clauses, for reading target, weapon and spell. Empty when nothing declared. */
  source: string;
}

const NOT_DECLARED: PlayerAttackRead = { declared: false, source: '' };

/** Pieces of the input, each with whether it ended in a question mark. */
function clausesOf(input: string): Array<{ text: string; question: boolean }> {
  // "but" and "then" end a clause; "and" does only before a new subject, so names and weapons
  // that contain it ("Sword and Shield Guard") stay whole.
  const marked = input.replace(
    /\s+(?:but|then)\b|\s+and(?=\s+(?:i|we|i'?m|i'?ll|let'?s)\b)/gi,
    ' |',
  );
  const parts = marked.split(/([,.;!?|]+)/);
  const pieces: Array<{ text: string; question: boolean }> = [];
  for (let index = 0; index < parts.length; index += 2) {
    const text = parts[index]
      .trim()
      .replace(/^(?:and|then|but|so|now|just|also|yes|okay|ok)\b[,\s]*/i, '')
      .trim();
    if (text) pieces.push({ text, question: Boolean(parts[index + 1]?.includes('?')) });
  }
  return pieces;
}

function clauseDeclares(clause: string, objects: AttackObjects): boolean {
  if (findPlayerCombatSpellInText(clause)) return true;
  if (DEFENSIVE.test(clause) || PASSIVE.test(clause)) return false;
  if (STRONG.test(clause) && !SOMEONE_ELSES.test(clause) && !NOT_A_FIGHT.test(clause)) return true;
  if (MELEE.test(clause) && (objects.namesHostile(clause) || objects.namesWeapon(clause))) {
    return !NOT_A_FIGHT.test(clause);
  }
  return (
    RANGED.test(clause) &&
    !NOT_A_PROJECTILE.test(clause) &&
    (objects.namesHostile(clause) || objects.namesWeapon(clause))
  );
}

/**
 * Whether the player's words declare a swing or a cast, and the clauses that do. A combat spell
 * they name; a strike verb with the player as its subject; or a contextual verb with a creature
 * or weapon for an object. A refusal is cut out first, so "I attack the zombie, not the monk" is an
 * attack on the zombie, and "I don't cast Sacred Flame, I swing my sword" is a sword swing.
 * Defensive, movement, passive, conditional and question phrasing ("I dodge their attack", "I
 * throw the rope", "Should I attack?", "If it moves, I attack") is not one.
 */
export function readPlayerAttack(playerInput: string, objects: AttackObjects): PlayerAttackRead {
  const input = playerInput.replace(/[’‘]/g, "'");
  if (CONDITIONAL.test(input)) return NOT_DECLARED;
  const affirmed = input.replace(REFUSED_SPAN, ' | ');
  const declaring = clausesOf(affirmed)
    .filter((clause) => !clause.question)
    .map((clause) => clause.text)
    .filter((clause) => clauseDeclares(clause, objects));
  return declaring.length ? { declared: true, source: declaring.join(', ') } : NOT_DECLARED;
}
