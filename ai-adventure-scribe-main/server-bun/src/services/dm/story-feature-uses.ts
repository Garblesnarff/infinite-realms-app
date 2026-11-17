/**
 * #712: class-feature uses the story spends, server-side, once per player message.
 *
 * Mirrors the story spell-slot spend (story-spell-slots.ts): the DM feature gate
 * reports the features the player's claim was allowed (`onFeaturesAllowed`), and
 * this module decrements them here, after the reply is allowed and before it is
 * persisted. Out of combat only — the combat turn resolves Lay on Hands through
 * combat-lay-on-hands.ts before the DM narrates. A failed spend is logged; it
 * never costs the player their turn.
 *
 * @module server/services/dm/story-feature-uses
 */

import { and, eq, ilike, or } from 'drizzle-orm';

import { db } from '../../../../db/client';
import { characters, dialogueHistory } from '../../../../db/schema/index';
import { logger } from '../../lib/logger.js';
import { detectDeclaredLayOnHands } from '../combat/combat-intent-gate.js';

type CharacterRow = typeof characters.$inferSelect;

const DIVINE_SENSE = 'divine sense';
const LAY_ON_HANDS = 'lay on hands';

/** An owned character whose name matches, when the match is unambiguous. */
async function ownedCharacterByName(userId: string, name: string): Promise<string | null> {
  const exact = await db
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        ilike(characters.name, name),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(2);
  if (exact.length === 1) return exact[0].id;
  if (exact.length > 1) return null;
  // Escape LIKE wildcards in the typed name so a literal % or _ cannot widen
  // the match (#744 nit). Backslash is the default LIKE escape in Postgres.
  const escapedName = name.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  const partial = await db
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        ilike(characters.name, `%${escapedName}%`),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(2);
  return partial.length === 1 ? partial[0].id : null;
}

/**
 * #1597: the id of a story Lay on Hands line. A retried turn answers the same player message, so
 * it gets the same seed and finds the row the first spend posted.
 */
function layOnHandsLineSeed(sessionId: string, since: Date | null, featureName: string): string {
  return `lay-on-hands:${sessionId}:${since ? since.toISOString() : 'none'}:${featureName}`;
}

/** #1597: the stored line of a Lay on Hands this message already spent, or null. */
async function storedLayOnHandsLine(
  sessionId: string,
  since: Date | null,
  featureName: string,
): Promise<string | null> {
  const { engineLineUuid } = await import('../engine-chat-line.js');
  const id = engineLineUuid(layOnHandsLineSeed(sessionId, since, featureName));
  const [row] = await db
    .select({ message: dialogueHistory.message })
    .from(dialogueHistory)
    .where(eq(dialogueHistory.id, id))
    .limit(1);
  return row?.message ?? null;
}

export async function spendStoryFeatureUses(input: {
  userId: string;
  sessionId: string;
  playerInput: string;
  character: CharacterRow;
  features: string[];
}): Promise<string[]> {
  const { userId, sessionId, playerInput, character, features } = input;
  // Dynamic import: the paladin service pulls in db/client at load time, and this
  // module is itself dynamically imported by the generate route (same pattern as
  // the story slot spend), so route contract tests stay database-free.
  const {
    spendDivineSense,
    resolveLayOnHands,
    featureSpentSinceMessage,
    DIVINE_SENSE_NAME,
    LAY_ON_HANDS_NAME,
  } = await import('../progression/paladin-features-service.js');
  const { playerMessage } = await import('./story-spell-slots.js');
  // #712 FIX round 4: a Retry replays the same saved player message without
  // saving a new one. A usage-log row for the feature at or after that message
  // means this message already spent it — the slot spend's `since` rule — so a
  // replay spends nothing again.
  const message = await playerMessage(sessionId);
  const since = message?.createdAt ?? null;

  let anyFeatureSpent = false;
  /** #1597: the engine lines of Lay on Hands the engine resolved (a refusal is not one). */
  const engineLines: string[] = [];
  for (const name of features) {
    const key = name.toLowerCase();
    try {
      const featureName =
        key === DIVINE_SENSE
          ? DIVINE_SENSE_NAME
          : key === LAY_ON_HANDS
            ? LAY_ON_HANDS_NAME
            : null;
      if (!featureName) {
        // The gate allowed the claim, but only the two pooled paladin features
        // spend here; anything else reaching this point is a wiring gap.
        logger.debug({ msg: 'DM_STORY_FEATURE_SPEND_UNHANDLED', sessionId, feature: name });
        continue;
      }
      if (
        await featureSpentSinceMessage({
          characterId: character.id,
          featureName,
          sessionId,
          since,
        })
      ) {
        logger.info({ msg: 'DM_STORY_FEATURE_SPEND_ALREADY_SPENT', sessionId, feature: name });
        // #1597: a retried turn spends nothing again, but its reply still needs the line the first
        // spend posted. Without it the gate replaces the heal narration with the no-effect line.
        if (featureName === LAY_ON_HANDS_NAME) {
          const line = await storedLayOnHandsLine(sessionId, since, featureName);
          if (line) engineLines.push(line);
        }
        continue;
      }
      if (key === DIVINE_SENSE) {
        const spent = await spendDivineSense({
          characterId: character.id,
          userId,
          sessionId,
          context: 'story-turn',
        });
        if (spent.success) anyFeatureSpent = true;
      } else if (key === LAY_ON_HANDS) {
        const declared = detectDeclaredLayOnHands(playerInput);
        let targetCharacterId: string | undefined;
        if (declared && !declared.targetIsSelf) {
          const named = await ownedCharacterByName(userId, declared.target);
          if (!named) {
            logger.warn({
              msg: 'DM_STORY_FEATURE_SPEND_TARGET_UNRESOLVED',
              sessionId,
              feature: name,
              target: declared.target,
            });
            continue;
          }
          targetCharacterId = named;
        }
        const laid = await resolveLayOnHands({
          characterId: character.id,
          userId,
          amount: declared?.amount ?? undefined,
          cure: declared?.cure ?? undefined,
          targetCharacterId,
          sessionId,
          context: 'story-turn',
        });
        if (laid.ok) {
          anyFeatureSpent = true;
          engineLines.push(laid.message);
          // The engine's line is a system row in the chat, as story damage and XP lines are.
          // A failed write must not fail the spend: the pool and HP already moved.
          try {
            const { postEngineChatLine } = await import('../engine-chat-line.js');
            await postEngineChatLine({
              sessionId,
              userId,
              idSeed: layOnHandsLineSeed(sessionId, since, featureName),
              text: laid.message,
              context: { intent: 'lay_on_hands', origin: 'story' },
            });
          } catch (error) {
            logger.warn({ msg: 'DM_STORY_LAY_ON_HANDS_LINE_FAILED', sessionId, error });
          }
        }
      }
    } catch (error) {
      logger.warn({ msg: 'DM_STORY_FEATURE_SPEND_FAILED', sessionId, feature: name, error });
    }
  }
  // #1085: a spent feature use is sheet state like damage/items/XP — the live
  // sheet only refreshes on `character_state_updated`, and no publish followed
  // a story feature spend, so the features panel went stale (and Lay on Hands
  // moves HP too). Only an actual spend publishes. A failed broadcast must
  // not fail the spend: the write already landed.
  if (anyFeatureSpent) {
    try {
      const { publishStoryCharacterUpdate } = await import('./story-broadcast.js');
      publishStoryCharacterUpdate(sessionId, 'story_features');
    } catch (broadcastError) {
      logger.warn({
        msg: 'DM_STORY_FEATURE_SPEND_BROADCAST_FAILED',
        sessionId,
        error: broadcastError instanceof Error ? broadcastError.message : String(broadcastError),
      });
    }
  }
  return engineLines;
}
