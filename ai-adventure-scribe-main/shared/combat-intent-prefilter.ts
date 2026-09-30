/**
 * The cheap "might this message declare an attack?" test, shared by the server's detector and
 * the client (#2341). The client asks `/v1/combat/sessions/:id/declared-attack` only when this
 * matches, so an ordinary turn costs no round trip. It is a prefilter, not a classifier: the
 * server's `detectDeclaredAttack` decides.
 */

/**
 * Deliberately small, clause-head vocabulary. This is not a classifier: it only recognizes
 * an attack-shaped clause and then resolves the named actor against the server roster.
 */
export const COMBAT_INTENT_VERBS = [
  'punch',
  'hit',
  'strike',
  'stab',
  'slash',
  'shoot',
  'attack',
  'kick',
  'headbutt',
  'tackle',
  'grapple',
  'shove',
  'slap',
  'elbow',
  'fire at',
  'fire',
  'swing',
  'swing at',
  'throw',
  'hurl',
  'launch',
  'loose',
  'blast',
  'zap',
  'cast',
] as const;

const COMBAT_INTENT_IDIOMS = ['take a swing', 'swing at', 'go for'] as const;

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const combatIntentPrefilter = new RegExp(
  [...COMBAT_INTENT_VERBS, ...COMBAT_INTENT_IDIOMS]
    .sort((left, right) => right.length - left.length)
    .map(
      (term) =>
        `\\b${term
          .split(/\s+/)
          .map((word) => escapeRegExp(word))
          .join('\\s+')}\\b`,
    )
    .join('|'),
  'i',
);

export const looksLikeCombatIntent = (playerInput: string): boolean =>
  combatIntentPrefilter.test(playerInput);
