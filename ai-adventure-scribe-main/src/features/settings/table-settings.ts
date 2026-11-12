/**
 * Per-user table settings (#1236 section F). Stored in this browser under a key
 * that includes the signed-in user id, so two accounts on one device do not share them.
 */
export type ReduceMotion = 'system' | 'on' | 'off';

/** Playback rates the narration Speed control offers. 1 is the normal rate. */
export const NARRATION_SPEEDS = [0.75, 1, 1.25, 1.5] as const;

export interface TableSettings {
  showTargetNumbers: boolean;
  narrationAutoPlay: boolean;
  /** 0 to 1. The narration player also reads `progressive-voice-volume`. */
  narrationVolume: number;
  /** One of NARRATION_SPEEDS. The audio element reads `progressive-voice-rate`. */
  narrationSpeed: number;
  diceSound: boolean;
  /** Kept so old saved data still parses. Nothing reads it: Table look is always on. */
  tableLook: boolean;
  reduceMotion: ReduceMotion;
  /** Read by the chat reader (NpcRollSummary): when on, the Behind the Screen summary renders under its DM message. */
  showNPCRolls: boolean;
}

export const DEFAULT_TABLE_SETTINGS: TableSettings = {
  showTargetNumbers: true,
  narrationAutoPlay: false,
  narrationVolume: 1,
  narrationSpeed: 1,
  diceSound: true,
  // #1413 records Rob's decision that Table look defaults on for everyone.
  tableLook: true,
  reduceMotion: 'system',
  showNPCRolls: true,
};

export const tableSettingsKey = (userId: string): string => `ir:table-settings:${userId}`;

const REDUCE_MOTION_VALUES: readonly ReduceMotion[] = ['system', 'on', 'off'];

const isVolume = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

const isSpeed = (value: unknown): value is number =>
  typeof value === 'number' && (NARRATION_SPEEDS as readonly number[]).includes(value);

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
      narrationVolume: isVolume(values.narrationVolume)
        ? values.narrationVolume
        : DEFAULT_TABLE_SETTINGS.narrationVolume,
      narrationSpeed: isSpeed(values.narrationSpeed)
        ? values.narrationSpeed
        : DEFAULT_TABLE_SETTINGS.narrationSpeed,
      diceSound:
        typeof values.diceSound === 'boolean' ? values.diceSound : DEFAULT_TABLE_SETTINGS.diceSound,
      tableLook:
        typeof values.tableLook === 'boolean' ? values.tableLook : DEFAULT_TABLE_SETTINGS.tableLook,
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
    window.dispatchEvent(new Event('ir-table-settings'));
    return true;
  } catch {
    return false;
  }
};
