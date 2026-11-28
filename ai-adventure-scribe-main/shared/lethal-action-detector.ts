/**
 * Conservative detector for a clearly lethal free-text act the player types
 * outside a live fight (#468 item 2). False positives must stay rare: an
 * ordinary look, a careful climb, a jump across a gap, a rescue, or an
 * attack must not raise the confirm card.
 */

const LETHAL_PATTERNS: ReadonlyArray<RegExp> = [
  // Off a drop or into something is only lethal when the line itself says so.
  // "cliff" or "chasm" alone is not enough ("I jump off the cliff to rescue
  // the child", "I leap off the cliff onto the ledge").
  /\b(?:i|we)\s+(?:step|walk|jump|leap|throw myself|hurl myself|fling myself)\s+(?:off|into)\b[^.!?]{0,60}\b(?:to my death|death|die|dying)\b/i,
  // A plain step, jump, leap or throw-myself off a drop, with nothing after it
  // in the sentence. A destination or purpose ("onto the ledge", "into the
  // lake", "to rescue the child") keeps it quiet.
  /\b(?:i|we)\s+(?:step|jump|leap|throw myself|hurl myself|fling myself)\s+off\s+(?:the\s+|a\s+)?(?:top\s+of\s+(?:the\s+)?)?(?:cliff|tower|roof|bridge|ledge|edge(?:\s+of\s+the\s+(?:cliff|tower|roof|bridge|ledge))?)\s*(?:[.!?]|$)/i,
  // Into the lava / magma / volcano itself, not a "lava cave".
  /\b(?:i|we)\s+(?:step|walk|jump|leap|dive|throw myself|hurl myself|fling myself)\s+into\s+(?:the\s+)?(?:lava|magma|volcano)\b(?!\s+cave)/i,
  // Drinking poison, not a "poison antidote".
  /\b(?:i|we)\s+drink(?:ing)?\s+(?:a\s+|the\s+|some\s+)?poison\b(?!\s+antidote)/i,
  /\b(?:i|we)\s+(?:kill myself|commit suicide|end my (?:life|days)|end it all)\b/i,
  /\b(?:i|we)\s+(?:slit|cut)\s+(?:my|our|own)\s+throat\b/i,
  /\b(?:i|we)\s+hang myself\b/i,
  /\b(?:i|we)\s+step\s+off\s+the\s+edge\b[^.!?]{0,40}\b(?:death|die|to my death)\b/i,
];

const ORDINARY_PLAY = /\b(?:look|looking|climb|climbing|carefully|gap|attack|fight|strike)\b/i;

export function isClearlyLethalAction(text: string, options: { inCombat?: boolean } = {}): boolean {
  if (options.inCombat) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;
  // Ordinary play stays quiet even if a later word happens to sound lethal,
  // unless the line itself is an unambiguous self-killing act.
  if (
    ORDINARY_PLAY.test(trimmed) &&
    !/\b(?:to my death|kill myself|suicide|lava|poison)\b/i.test(trimmed)
  ) {
    return false;
  }
  return LETHAL_PATTERNS.some((pattern) => pattern.test(trimmed));
}
