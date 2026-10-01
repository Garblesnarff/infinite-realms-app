import { logger } from '../../lib/logger.js';

import type { CombatIntentActor } from './combat-intent-gate.js';

const NPC_CHUNK_TYPES = ['npc_tier1', 'npc_tier2', 'npc_tier3'] as const;

const normalizeName = (value: string): string => value.trim().toLocaleLowerCase();

const titleizeCanonicalName = (value: string): string =>
  value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ');

const stringField = (record: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

function addActor(actors: Map<string, CombatIntentActor>, actor: CombatIntentActor): void {
  const name = actor.name.trim();
  if (!name) return;
  const key = normalizeName(name);
  if (!key) return;
  const previous = actors.get(key);
  if (!previous) {
    actors.set(key, { ...actor, name });
    return;
  }

  // Preserve the first source's display name while filling identity fields from later sources.
  actors.set(key, {
    ...previous,
    actorSlug: previous.actorSlug ?? actor.actorSlug,
    slug: previous.slug ?? actor.slug,
    monsterId: previous.monsterId ?? actor.monsterId,
  });
}

function actorsFromFacts(facts: unknown[]): CombatIntentActor[] {
  const actors: CombatIntentActor[] = [];
  for (const fact of facts) {
    if (!fact || typeof fact !== 'object') continue;
    const row = fact as { subjectName?: unknown; value?: unknown };
    const value =
      row.value && typeof row.value === 'object' ? (row.value as Record<string, unknown>) : {};
    const subjectName = typeof row.subjectName === 'string' ? row.subjectName : '';
    const displayName = stringField(value, 'name', 'displayName', 'display_name') ?? subjectName;
    if (displayName.trim()) {
      actors.push({ name: titleizeCanonicalName(displayName), source: 'ledger' });
    }
  }
  return actors;
}

/**
 * Build the actor roster for one request. Every source is read per request so a stale prompt or
 * global roster cannot authorize an attack against an actor who is not in this session.
 *
 * Database imports stay inside the function on purpose. The pure intent detector and route
 * contract tests can load this module without opening the application database.
 */
export async function loadCombatIntentActorRoster(
  sessionId: string,
  userId: string,
): Promise<CombatIntentActor[]> {
  const actors = new Map<string, CombatIntentActor>();

  try {
    const [{ SessionService }, { NarrativeLedgerService }, { loadActiveTacticalMap }] =
      await Promise.all([
        import('../session-service.js'),
        import('../narrative/narrative-ledger-service.js'),
        import('./tactical-map-store.js'),
      ]);

    const session = await SessionService.getSessionById(sessionId, userId);
    const [facts, tacticalMap] = await Promise.all([
      NarrativeLedgerService.currentFacts(sessionId, userId, { subjectType: 'npc' }).catch(
        (error: unknown) => {
          logger.warn({
            msg: 'COMBAT_INTENT_NARRATIVE_ROSTER_UNAVAILABLE',
            sessionId,
            error,
          });
          return [];
        },
      ),
      loadActiveTacticalMap(sessionId).catch((error: unknown) => {
        logger.warn({
          msg: 'COMBAT_INTENT_TACTICAL_ROSTER_UNAVAILABLE',
          sessionId,
          error,
        });
        return null;
      }),
    ]);

    for (const actor of actorsFromFacts(facts)) addActor(actors, actor);

    for (const entity of tacticalMap?.entities ?? []) {
      if (entity.type === 'pc') continue;
      const name = entity.name?.trim() || entity.slug?.trim() || entity.id.trim();
      if (!name) continue;
      addActor(actors, {
        name,
        source: 'map',
        ...(entity.slug?.trim() ? { actorSlug: entity.slug.trim() } : {}),
      });
    }

    const [{ db }, { campaignChunks, npcs }, { and, eq, inArray, isNotNull }] = await Promise.all([
      import('../../../../db/client.js'),
      import('../../../../db/schema/index.js'),
      import('drizzle-orm'),
    ]);

    const campaignNpcPromise = session.campaignId
      ? db
          .select({ name: npcs.name, id: npcs.id })
          .from(npcs)
          .where(eq(npcs.campaignId, session.campaignId))
      : Promise.resolve([] as Array<{ name: string; id: string }>);

    const campaignAssetId = session.starterCampaignId;
    const campaignAssetPromise = campaignAssetId
      ? db
          .select({ entityName: campaignChunks.entityName, metadata: campaignChunks.metadata })
          .from(campaignChunks)
          .where(
            and(
              eq(campaignChunks.campaignId, campaignAssetId),
              inArray(campaignChunks.chunkType, [...NPC_CHUNK_TYPES]),
              isNotNull(campaignChunks.entityName),
            ),
          )
      : Promise.resolve([] as Array<{ entityName: string | null; metadata: unknown }>);

    const [campaignNpcs, campaignAssets] = await Promise.all([
      campaignNpcPromise.catch((error: unknown) => {
        logger.warn({ msg: 'COMBAT_INTENT_CAMPAIGN_NPCS_UNAVAILABLE', sessionId, error });
        return [] as Array<{ name: string; id: string }>;
      }),
      campaignAssetPromise.catch((error: unknown) => {
        logger.warn({ msg: 'COMBAT_INTENT_CAMPAIGN_ASSETS_UNAVAILABLE', sessionId, error });
        return [] as Array<{ entityName: string | null; metadata: unknown }>;
      }),
    ]);

    for (const npc of campaignNpcs) {
      addActor(actors, { name: npc.name, actorSlug: npc.id, source: 'campaign' });
    }
    for (const asset of campaignAssets) {
      if (!asset.entityName?.trim()) continue;
      const metadata =
        asset.metadata && typeof asset.metadata === 'object'
          ? (asset.metadata as Record<string, unknown>)
          : {};
      addActor(actors, {
        name: asset.entityName,
        source: 'campaign',
        ...(stringField(metadata, 'slug', 'actor_slug', 'actorSlug')
          ? { actorSlug: stringField(metadata, 'slug', 'actor_slug', 'actorSlug') }
          : {}),
        ...(stringField(metadata, 'monster_id', 'monsterId')
          ? { monsterId: stringField(metadata, 'monster_id', 'monsterId') }
          : {}),
      });
    }
  } catch (error) {
    // The gate fails closed when the roster cannot be loaded. The turn itself still reaches the
    // model, but no actor can be server-declared from an unavailable source.
    logger.warn({ msg: 'COMBAT_INTENT_ACTOR_ROSTER_UNAVAILABLE', sessionId, error });
  }

  return [...actors.values()];
}
