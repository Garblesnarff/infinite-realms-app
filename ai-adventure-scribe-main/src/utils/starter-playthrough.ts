type UnknownRecord = Record<string, unknown>;

const STARTER_BOOLEAN_KEYS = [
  'isStarterPlaythrough',
  'is_starter_playthrough',
  'isStarterCampaign',
  'is_starter_campaign',
  'isStarter',
  'is_starter',
] as const;

const STARTER_TYPE_KEYS = ['campaignType', 'campaign_type', 'type', 'kind'] as const;

const STARTER_TYPE_VALUES = new Set(['starter', 'starter_campaign', 'starter_playthrough']);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function normalizeType(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function hasSignal(value: unknown, visited: Set<UnknownRecord>): boolean {
  if (!isRecord(value) || visited.has(value)) return false;
  visited.add(value);

  if (STARTER_BOOLEAN_KEYS.some((key) => value[key] === true)) return true;
  if (STARTER_TYPE_KEYS.some((key) => STARTER_TYPE_VALUES.has(normalizeType(value[key]) || ''))) {
    return true;
  }

  return ['metadata', 'campaign', 'basic'].some((key) => hasSignal(value[key], visited));
}

/**
 * Returns true only when data explicitly identifies a starter campaign or playthrough.
 * Campaign names are deliberately not treated as a signal because custom campaigns may use
 * the same display names and a missing nullable FK is normal for them.
 */
export function hasStarterPlaythroughSignal(value: unknown): boolean {
  return hasSignal(value, new Set<UnknownRecord>());
}
