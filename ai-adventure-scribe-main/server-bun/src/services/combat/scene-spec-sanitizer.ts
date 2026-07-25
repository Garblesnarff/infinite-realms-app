import type {
  EnemyPlacement,
  SceneEnvironment,
  SceneSize,
  SceneSpec,
} from '../../tactical/types.js';

/**
 * The DM model authors `scene_spec` freely, which means every field arrives untrusted.
 * Two of them used to be dangerous:
 *
 *  - `sessionId` — a model-invented value ("eternal_feast_01") that is a real foreign key
 *    on the tactical map. It is now ALWAYS replaced with the route parameter.
 *  - `id` — the tactical map's primary key. Treated as a suggestion and discarded; the
 *    server mints the id.
 *
 * Everything else is either validated against a closed union, range-checked, or dropped.
 * `pcEntities`/`enemyEntities` are dropped outright: those ids become tactical entity ids
 * and must come from the just-inserted combat participants, never from the model.
 */
const ENVIRONMENTS = new Set<SceneEnvironment>([
  'dungeon_room',
  'cave',
  'tavern',
  'forest_clearing',
  'road',
  'ruins',
  'ship_deck',
  'open_field',
  'corridor',
]);
const SIZES = new Set<SceneSize>(['small', 'medium', 'large']);
const PLACEMENTS = new Set<EnemyPlacement>(['ambush', 'guarding', 'formation']);

const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_SEED = 2_147_483_647;

export type SceneSpecSanitizeResult =
  | { ok: true; sceneSpec: SceneSpec; overrides: string[] }
  | { ok: false; detail: string };

export function sanitizeSceneSpec(raw: unknown, sessionId: string): SceneSpecSanitizeResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, detail: 'sceneSpec must be an object' };
  }

  const input = raw as Record<string, unknown>;
  const environment = typeof input.environment === 'string' ? input.environment : '';
  if (!ENVIRONMENTS.has(environment as SceneEnvironment)) {
    return {
      ok: false,
      detail: `sceneSpec.environment must be one of: ${[...ENVIRONMENTS].join(', ')}`,
    };
  }

  const overrides: string[] = [];
  if (typeof input.sessionId === 'string' && input.sessionId !== sessionId) {
    overrides.push('sessionId');
  }
  if (input.id !== undefined && input.id !== null) overrides.push('id');
  if (input.pcEntities !== undefined || input.enemyEntities !== undefined) {
    overrides.push('entities');
  }

  const size = typeof input.size === 'string' && SIZES.has(input.size as SceneSize)
    ? (input.size as SceneSize)
    : 'medium';
  if (input.size !== undefined && input.size !== size) overrides.push('size');

  // Left undefined when unusable so the generator keeps its own default placement.
  const placement =
    typeof input.enemyPlacement === 'string' && PLACEMENTS.has(input.enemyPlacement as EnemyPlacement)
      ? (input.enemyPlacement as EnemyPlacement)
      : undefined;
  if (input.enemyPlacement !== undefined && input.enemyPlacement !== null && !placement) {
    overrides.push('enemyPlacement');
  }

  const rawSeed = Number(input.seed);
  const seed =
    Number.isInteger(rawSeed) && rawSeed >= 0 && rawSeed <= MAX_SEED ? rawSeed : undefined;
  if (input.seed !== undefined && input.seed !== null && seed === undefined) {
    overrides.push('seed');
  }

  const description =
    typeof input.sceneDescription === 'string'
      ? input.sceneDescription.slice(0, MAX_DESCRIPTION_LENGTH)
      : undefined;

  return {
    ok: true,
    overrides,
    sceneSpec: {
      // Route param wins, always. Never the model's guess.
      sessionId,
      environment: environment as SceneEnvironment,
      size,
      ...(placement === undefined ? {} : { enemyPlacement: placement }),
      ...(seed === undefined ? {} : { seed }),
      ...(description === undefined ? {} : { sceneDescription: description }),
    },
  };
}
