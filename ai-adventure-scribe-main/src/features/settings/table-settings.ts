/**
 * Per-user table settings (#1236 section F). Stored in this browser under a key
 * that includes the signed-in user id, so two accounts on one device do not share them.
 */
export type ReduceMotion = 'system' | 'on' | 'off';

export interface TableSettings {
  showTargetNumbers: boolean;
  narrationAutoPlay: boolean;
  diceSound: boolean;
  reduceMotion: ReduceMotion;
  showNPCRolls: boolean;
}

export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  showTargetNumbers: true,
  narrationAutoPlay: false,
  diceSound: true,
  reduceMotion: 'system',
  showNPCRolls: true,
};

export const tableSettingsKey = (userId: string): string => `ir:table-settings:${userId}`;

const REDUCE_MOTION_VALUES: readonly ReduceMotion[] = ['system', 'on', 'off'];

/** Reads settings for one user. Missing or unreadable values fall back to the defaults. */
export const readTableSettings = (userId: string): TableSettings => {
  try {
    const raw = window.localStorage.getItem(tableSettingsKey(userId));
    if (!raw) return { ...DEFAULT_TABLE_SETTINGS };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_TABLE_SETTINGS };
    const values = parsed as Record<string, unknown>;
    return {
      showTargetNumbers:
        typeof values.showTargetNumbers === 'boolean'
          ? values.showTargetNumbers
          : DEFAULT_TABLE_SETTINGS.showTargetNumbers,
      narrationAutoPlay:
        typeof values.narrationAutoPlay === 'boolean'
          ? values.narrationAutoPlay
          : DEFAULT_TABLE_SETTINGS.narrationAutoPlay,
      diceSound:
        typeof values.diceSound === 'boolean' ? values.diceSound : DEFAULT_TABLE_SETTINGS.diceSound,
      reduceMotion:
        typeof values.reduceMotion === 'string' &&
        REDUCE_MOTION_VALUES.includes(values.reduceMotion as ReduceMotion)
          ? (values.reduceMotion as ReduceMotion)
          : DEFAULT_TABLE_SETTINGS.reduceMotion,
      showNPCRolls:
        typeof values.showNPCRolls === 'boolean'
          ? values.showNPCRolls
          : DEFAULT_TABLE_SETTINGS.showNPCRolls,
    };
  } catch {
    return { ...DEFAULT_TABLE_SETTINGS };
  }
};

/** Writes settings for one user. Returns false when the browser refuses the write. */
export const writeTableSettings = (userId: string, settings: TableSettings): boolean => {
  try {
    window.localStorage.setItem(tableSettingsKey(userId), JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
};
