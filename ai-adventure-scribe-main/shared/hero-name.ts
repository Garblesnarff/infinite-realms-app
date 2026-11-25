/**
 * #1741: the name a player gives a premade hero. One rule for the client's field and the
 * server's create route, so the two cannot drift apart.
 */

export const HERO_NAME_MAX_LENGTH = 40;

// Letters, combining marks (so a decomposed 'Zoë' passes), spaces, apostrophes (straight or
// curly) and hyphens. Starts with a letter.
export const HERO_NAME_PATTERN = /^\p{L}[\p{L}\p{M} '’-]*$/u;

export type HeroNameCheck = { ok: true; name: string } | { ok: false; message: string };

/**
 * Check the typed name. An empty field keeps the premade's title as the name. The name is
 * trimmed before it is checked, so the stored name never has outer spaces.
 */
export function checkHeroName(typed: string, title: string): HeroNameCheck {
  const name = typed.trim();
  if (name === '') return { ok: true, name: title };
  if (name.length > HERO_NAME_MAX_LENGTH) {
    return { ok: false, message: `Use ${HERO_NAME_MAX_LENGTH} characters or fewer.` };
  }
  if (!HERO_NAME_PATTERN.test(name)) {
    return { ok: false, message: 'Use letters, spaces, apostrophes and hyphens only.' };
  }
  return { ok: true, name };
}

/** "Mara, the Seeker" for a hero named Mara with the title "The Seeker". */
export function heroEpithetName(name: string, title: string): string {
  if (name === title) return title;
  return `${name}, ${title.replace(/^The /, 'the ')}`;
}
