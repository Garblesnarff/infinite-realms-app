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
import { characters } from '../../../../db/schema/index';
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
  const partial = await db
    .select({ id: characters.id })
    .from(characters)
    .where(
      and(
        ilike(characters.name, `%${name}%`),
        or(eq(characters.userId, userId), eq(characters.ownerId, userId)),
      ),
    )
    .limit(2);
  return partial.length === 1 ? partial[0].id : null;
}

export async function spendStoryFeatureUses(input: {
  userId: string;
  sessionId: string;
  playerInput: string;
  character: CharacterRow;
  features: string[];
}): Promise<void> {
  const { userId, sessionId, playerInput, character, features } = input;
  // Dynamic import: the paladin service pulls in db/client at load time, and this
  // module is itself dynamically imported by the generate route (same pattern as
  // the story slot spend), so route contract tests stay database-free.
  const { spendDivineSense, resolveLayOnHands } = await import(
    '../progression/paladin-features-service.js'
  );

  for (const name of features) {
    const key = name.toLowerCase();
    try {
      if (key === DIVINE_SENSE) {
        await spendDivineSense({
          characterId: character.id,
          userId,
          sessionId,
          context: 'story-turn',
        });
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
        await resolveLayOnHands({
          characterId: character.id,
          userId,
          amount: declared?.amount ?? undefined,
          cure: declared?.cure ?? undefined,
          targetCharacterId,
          sessionId,
          context: 'story-turn',
        });
      } else {
        // The gate allowed the claim, but only the two pooled paladin features
        // spend here; anything else reaching this point is a wiring gap.
        logger.debug({ msg: 'DM_STORY_FEATURE_SPEND_UNHANDLED', sessionId, feature: name });
      }
    } catch (error) {
      logger.warn({ msg: 'DM_STORY_FEATURE_SPEND_FAILED', sessionId, feature: name, error });
    }
  }
}
