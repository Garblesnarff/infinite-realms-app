/**
 * #751: a rest the player types ("I take a long rest…") is a rest even when the DM reply
 * carries no `rest`. A question or a negation is not a declaration.
 */
export function typedRestType(text: string): 'short' | 'long' | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\?\s*$/.test(t) || /^(can|could|should|shall|may|do|does|is|are|will|would)\b/.test(t))
    return null;
  if (/\b(?:not|never|don'?t|won'?t|can'?t|cannot|refuse to|no)\b/.test(t)) return null;
  if (
    /^(?:i|we) (?:take|begin|start|have) (?:a |the )?(?:full |long |full long )rest\b/.test(t) ||
    /^(?:i|we) rest (?:for|through) the night\b/.test(t) ||
    /^(?:i|we) (?:sleep|rest) (?:for )?(?:eight|8) hours\b/.test(t)
  ) {
    return 'long';
  }
  if (
    /^(?:i|we) (?:take|begin|start|have) (?:a |the )?short rest\b/.test(t) ||
    /^(?:i|we) rest for an hour\b/.test(t) ||
    /^(?:i|we) take a breather\b/.test(t)
  ) {
    return 'short';
  }
  return null;
}
