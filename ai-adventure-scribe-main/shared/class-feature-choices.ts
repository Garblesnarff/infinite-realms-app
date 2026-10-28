/**
 * Reading the choices stored in a character's `class_features` JSONB.
 *
 * The creation wizard stores one entry per class feature:
 * `Record<featureId, { name, description, choice? }>` where `choice` is the
 * full option string the player picked (e.g. a sorcerer's
 * `'Draconic Bloodline: Your innate magic comes from draconic magic...'`
 * under `sorcerous-origin`, a cleric's `'Life Domain: ...'` under
 * `divine-domain`). Level-1 derived stats (Draconic Resilience HP/AC) key off
 * that choice, and the browser, the Bun server and the test suites all read
 * it — so the parsing lives here, dependency-free, rather than being copied.
 */

export interface ClassFeatureChoiceEntry {
  name?: unknown;
  description?: unknown;
  choice?: unknown;
}

/** The option string chosen for one class feature, or null when none was stored. */
export function getClassFeatureChoice(
  classFeatures: unknown,
  featureId: string,
): string | null {
  if (!classFeatures || typeof classFeatures !== 'object') return null;
  const entry = (classFeatures as Record<string, ClassFeatureChoiceEntry>)[featureId];
  if (!entry || typeof entry !== 'object') return null;
  return typeof entry.choice === 'string' && entry.choice.length > 0 ? entry.choice : null;
}

/**
 * True when the character's Sorcerous Origin choice is Draconic Bloodline —
 * the origin whose level-1 features (Draconic Resilience, Dragon Ancestor)
 * change derived stats.
 */
export function isDraconicBloodline(classFeatures: unknown): boolean {
  const choice = getClassFeatureChoice(classFeatures, 'sorcerous-origin');
  return choice !== null && choice.startsWith('Draconic Bloodline');
}

/**
 * The subclass the wizard recorded in a class feature's choice string, or null.
 * A cleric's `'Life Domain: ...'` under `divine-domain` yields `'Life Domain'`.
 * Only names in `subclassNames` count, so an unrelated choice never matches.
 */
export function subclassFromClassFeatureChoices(
  classFeatures: unknown,
  subclassNames: readonly string[],
): string | null {
  if (!classFeatures || typeof classFeatures !== 'object') return null;
  for (const entry of Object.values(classFeatures)) {
    const choice = (entry as ClassFeatureChoiceEntry | null)?.choice;
    if (typeof choice !== 'string') continue;
    const match = subclassNames.find((name) => choice.startsWith(name));
    if (match) return match;
  }
  return null;
}
