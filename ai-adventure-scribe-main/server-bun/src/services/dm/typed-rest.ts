/**
 * #751: a rest the player types ("I take a long rest…") is a rest even when the DM reply
 * carries no `rest`. A question or a negation is not a declaration.
 */
export function typedRestType(text: string): 'short' | 'long' | null {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\?\s*$/.test(t) || /^(can|could|should|shall|may|do|does|is|are|will|would)\b/.test(t))
    return null;
  if (/\b(?:not|never|don'?t|do not|won'?t|refuse to|no)\b[^.!]{0,20}\brest/.test(t)) return null;
  if (
    /\b(?:long|full) rest\b/.test(t) ||
    /\brest (?:for|through) the night\b/.test(t) ||
    /\b(?:sleep|rest)\w* (?:for )?(?:eight|8) hours\b/.test(t)
  ) {
    return 'long';
  }
  if (/\bshort rest\b/.test(t) || /\brest for an hour\b/.test(t) || /\btake a breather\b/.test(t)) {
    return 'short';
  }
  return null;
}
