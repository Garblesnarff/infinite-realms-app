/**
 * The D&D 5e ability modifier, shared by the browser, the Bun server and Deno edge functions.
 * Every caller that holds a raw ability score uses this one owner.
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}
