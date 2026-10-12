export const CHARACTER_NAME_MAX_LENGTH = 50;
const CHARACTER_NAME_PATTERN = /^[a-zA-Z\s\-']+$/;

export function getCharacterNameError(name: string): string | null {
  if (!name || name.trim().length === 0) {
    return 'Character name is required';
  }

  if (name.length > CHARACTER_NAME_MAX_LENGTH) {
    return 'Name must be ' + CHARACTER_NAME_MAX_LENGTH + ' characters or less';
  }

  if (!CHARACTER_NAME_PATTERN.test(name)) {
    return 'Name can only contain letters, spaces, hyphens, and apostrophes';
  }

  return null;
}
