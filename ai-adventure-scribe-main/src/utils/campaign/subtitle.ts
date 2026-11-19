/**
 * A tagline is a second line under the title only when it says something the title does not.
 * The comparison ignores case and surrounding spaces (#1672).
 */
export function isDistinctSubtitle(title: string, subtitle: string | null | undefined): boolean {
  const sub = subtitle?.trim() ?? '';
  if (!sub) return false;
  return sub.toLocaleLowerCase() !== title.trim().toLocaleLowerCase();
}
