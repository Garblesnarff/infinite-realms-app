/** Keep a model-authored options appendix out of story text, including partial previews. */
export function stripOptionsAppendix(text: string): string {
  return text.replace(/\s*\n\s*["']?options["']?\s*:\s*\[[\s\S]*$/i, '').trimEnd();
}
