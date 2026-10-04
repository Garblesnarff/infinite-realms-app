/**
 * IDLE_ENCOUNTER_SWEEP - the rule that closes abandoned combat encounters (#2556).
 *
 * An `active` encounter is what the client resumes into on reload, and metrics read it as "fight
 * in progress". Prod carried 42 of them, the oldest untouched since 2026-07-25, all closed by
 * hand on an ops session with a typed line from Rob. This is the rule so they do not recur.
 *
 * It closes them the way they were closed by hand -- through `concludeEncounter`, which claims
 * the ending idempotently, writes the DM a sentence to narrate, tears down the tactical map,
 * logs the ending and republishes the state to the client. A raw UPDATE would leave exactly the
 * hole run 18's encounter 2 was: `completed` with no reason and nothing for the DM to read.
 *
 * @module server/services/combat/idle-encounter-sweeper
 */
import { and, eq, gte, inArray, lt, notExists, sql } from 'drizzle-orm';

import { concludeEncounter } from './combat-ending.js';
import { db } from '../../../../db/client';
import {
  campaigns,
  characters,
  combatEncounters,
  dialogueHistory,
  gameSessions,
  tacticalMaps,
} from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';

/** One encounter the sweeper may close, with the identity `concludeEncounter` needs to act. */
interface IdleEncounterRow {
  encounterId: string;
  sessionId: string;
  /** Null when the session has neither a campaign nor a character to attribute it to. */
  ownerUserId: string | null;
}

/**
 * A session is alive if a player or the DM spoke in it. `system` is excluded on purpose: a
 * declined roll (#2291) writes one without a human having been present, and treating that as
 * play would keep abandoned encounters alive forever.
 */
const PLAYER_OR_DM_SPEAKERS = ['player', 'dm'] as const;

/**
 * IDLE_ENCOUNTER_HOURS - Close encounters whose sessions stopped talking.
 * #2556: 42 `combat_encounters` rows sat `active` in prod, the oldest from 2026-07-25. Closing
 * them by hand cost an ops session and a typed line from Rob each time, and an `active` row is
 * what the client resumes into on reload, so a returning player could drop straight into a fight
 * the DM had long stopped narrating.
 *
 * Measured the way the manual cleanup measured it: an encounter counts as idle when its session
 * has produced no `dialogue_history` row with a player or DM speaker for this long. `system`
 * lines are excluded because a refused roll or a declined option writes one without anyone
 * having been present; `companion` rows are not the party either.
 *
 * Deliberately generous. A day of silence is a scene nobody returned to, and the cost of
 * waiting is a stale row; the cost of closing early is killing a fight somebody came back to.
 */
export const IDLE_ENCOUNTER_HOURS = 24;

/** The hourly tick. The sweeper does nothing when there is nothing idle, so this costs one query. */
const IDLE_ENCOUNTER_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/** True while a tick is running, so the next hour cannot start a second sweep on top of it. */
let sweepInFlight = false;

/**
 * Every active encounter in a session with no player or DM dialogue for the idle window, with
 * the owner `concludeEncounter` has to be called as.
 *
 * The owner comes from `campaigns.user_id`, not from the session: `game_sessions` has no
 * `user_id` of its own, and Hetzner's first run of the manual cleanup failed on exactly that
 * lookup before it wrote anything. `campaign_id` is nullable though -- `session-service.ts`
 * creates character-only and resource-less sessions with `campaignId: null` -- so the join is a
 * LEFT one and the character is the fallback. An INNER join here would quietly exempt every
 * such session from the rule forever, which is the same failure this ticket exists to end.
 *
 * Activity is measured on `created_at`, not `timestamp`. `timestamp` is written from the
 * browser (`session-message-service.ts` persists the client's value), so a machine with a wrong
 * clock would either pin a live fight open indefinitely or get a fight being played right now
 * closed out from under it. `created_at` is the server's own clock and is NOT NULL, which is
 * also why it cannot be defeated by a null row -- the same reasoning as `dmRowExistsSince`.
 *
 * Dialogue alone is NOT enough to call a fight live (#2556 review). `startCombat` inserts the
 * encounter row and writes no dialogue, so a player who walks back into a quiet session and
 * starts a fight would have it closed at the next tick. Every clock has to agree that the fight
 * is untouched:
 *
 *  - `combat_encounters.updated_at` moves on every engine write that carries the encounter's
 *    liveness: turn advance (`combat-initiative-service.ts`), turn and bonus-action claims
 *    (`combat-turn-resources.ts`), and pending-intent queue/clear (`combat-pending-intent-service.ts`).
 *  - `combat_encounters.started_at` stops a fight that began inside the window from being swept
 *    no matter what else the row says. `startCombat` sets it explicitly, so it need not equal the
 *    row's own `created_at`. `created_at` is deliberately NOT a separate predicate: insert sets it
 *    and `updated_at` together and no writer backdates `updated_at`, so `updated_at >= created_at`
 *    always holds and the `updated_at` predicate already implies the `created_at` one. A third
 *    identical clock would be a predicate that cannot change any outcome.
 *  - `tactical_maps.updated_at` covers the activity that does NOT touch the encounter row:
 *    `CombatHPService.applyDamage` only joins `combat_encounters`, it never updates it, and
 *    `claimEncounterVersion` -- the one writer that would -- has no callers. Map writes (movement,
 *    forced AoE moves, DM facts) all set `tactical_maps.updated_at`, so it is the signal that
 *    survives damage and movement.
 */
async function findIdleEncounters(idleHours: number): Promise<IdleEncounterRow[]> {
  const idleThreshold = new Date(Date.now() - idleHours * 60 * 60 * 1000);

  return db
    .select({
      encounterId: combatEncounters.id,
      sessionId: combatEncounters.sessionId,
      // Either arm satisfies `endCombat`'s ownership predicate, so the first that exists is
      // enough to act as the owner. `characters.ownerId` is deliberately NOT in here:
      // `characters.user_id` is NOT NULL, so a character row always has one and that branch is
      // unreachable. (`endCombat` still accepts `owner_id`, which is correct -- it is not this
      // query's job to narrow what the authorization allows.)
      ownerUserId: sql<string | null>`coalesce(${campaigns.userId}, ${characters.userId})`,
    })
    .from(combatEncounters)
    .innerJoin(gameSessions, eq(combatEncounters.sessionId, gameSessions.id))
    .leftJoin(campaigns, eq(gameSessions.campaignId, campaigns.id))
    .leftJoin(characters, eq(gameSessions.characterId, characters.id))
    .where(
      and(
        eq(combatEncounters.status, 'active'),
        lt(combatEncounters.startedAt, idleThreshold),
        lt(combatEncounters.updatedAt, idleThreshold),
        notExists(
          db
            .select({ id: dialogueHistory.id })
            .from(dialogueHistory)
            .where(
              and(
                eq(dialogueHistory.sessionId, combatEncounters.sessionId),
                inArray(dialogueHistory.speakerType, PLAYER_OR_DM_SPEAKERS),
                gte(dialogueHistory.createdAt, idleThreshold),
              ),
            ),
        ),
        notExists(
          db
            .select({ id: tacticalMaps.id })
            .from(tacticalMaps)
            .where(
              and(
                eq(tacticalMaps.sessionId, combatEncounters.sessionId),
                gte(tacticalMaps.updatedAt, idleThreshold),
              ),
            ),
        ),
      ),
    );
}

/**
 * Close every idle encounter through `concludeEncounter`, the one function allowed to end a
 * fight. Never a raw UPDATE: the DM note, the tactical-map teardown and the client update are
 * the point, and a row flipped to `completed` on its own is what run 18's encounter 2 was.
 *
 * One encounter failing must not strand the rest, so each is closed in its own try. `concludeEncounter`
 * is idempotent on the `active -> completed` claim, which is what makes a second run in the same
 * hour (or a retry after a crash) a no-op rather than a second ending.
 *
 * Ids and counts only: this runs unattended on a schedule and its log is read by whoever is
 * on call, not by the player whose fight it was.
 *
 * @returns the ids it closed, the ids whose close threw, and the ids it could not act on at all
 *   because no owner could be resolved for their session
 */
export async function sweepIdleEncounters(): Promise<{
  closed: string[];
  failed: string[];
  skipped: string[];
}> {
  const idle = await findIdleEncounters(IDLE_ENCOUNTER_HOURS);
  const closed: string[] = [];
  const failed: string[] = [];
  const skipped: string[] = [];

  for (const { encounterId, sessionId, ownerUserId } of idle) {
    // `endCombat` authorises on the session's campaign or character owner, so with neither there
    // is nobody to act as. Reported rather than dropped: an encounter silently exempted from the
    // rule is the exact outcome this ticket exists to end.
    if (!ownerUserId) {
      skipped.push(encounterId);
      logger.warn({ msg: 'IDLE_ENCOUNTER_NO_OWNER', encounterId, sessionId });
      continue;
    }
    try {
      await concludeEncounter(encounterId, sessionId, ownerUserId, 'ended_idle');
      closed.push(encounterId);
    } catch (error) {
      failed.push(encounterId);
      logger.error({
        msg: 'IDLE_ENCOUNTER_CLOSE_FAILED',
        encounterId,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info({
    msg: 'IDLE_ENCOUNTER_SWEEP',
    idleHours: IDLE_ENCOUNTER_HOURS,
    idle: idle.length,
    closed: closed.length,
    failed: failed.length,
    skipped: skipped.length,
    closedEncounterIds: closed,
    failedEncounterIds: failed,
    skippedEncounterIds: skipped,
  });

  return { closed, failed, skipped };
}

/**
 * One hourly tick: run the sweep, never let it escape, never overlap itself.
 *
 * `sweep` is injectable so both guarantees below can be asserted directly; production passes the
 * real one and nothing else does.
 *
 * The catch matters because `void sweepIdleEncounters()` in a `setInterval` callback hands a
 * rejected query (a DB blip) to the process-wide `unhandledRejection` handler in `index.ts`,
 * which logs the whole promise object. Here it becomes one `IDLE_ENCOUNTER_SWEEP_FAILED` line
 * naming the error, and the next hour retries. The in-flight flag stops a slow sweep starting a
 * second one on top of it: the claim inside `concludeEncounter` would keep that safe, but both
 * sweeps would pay for the same query and write two `IDLE_ENCOUNTER_SWEEP` lines for one hour.
 */
export async function runIdleEncounterSweepTick(
  sweep: () => Promise<unknown> = sweepIdleEncounters,
): Promise<void> {
  if (sweepInFlight) {
    logger.warn({ msg: 'IDLE_ENCOUNTER_SWEEP_SKIPPED', reason: 'sweep_already_in_flight' });
    return;
  }
  sweepInFlight = true;
  try {
    await sweep();
  } catch (error) {
    logger.error({
      msg: 'IDLE_ENCOUNTER_SWEEP_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    sweepInFlight = false;
  }
}

/**
 * Start the hourly tick. Lives beside `startModelHealthChecks` in `index.ts` because that is the
 * server's existing scheduled path: the process already owns its own recurring maintenance, so
 * the sweeper needs no crontab entry and no host change. #2507's watchdog was not the right
 * home -- that is an ops script that restarts units, and this is application work that needs the
 * DB and the ending funnel.
 */
export function startIdleEncounterSweep(): ReturnType<typeof setInterval> {
  const interval = setInterval(
    () => void runIdleEncounterSweepTick(),
    IDLE_ENCOUNTER_SWEEP_INTERVAL_MS,
  );
  if (typeof interval.unref === 'function') interval.unref();
  return interval;
}
