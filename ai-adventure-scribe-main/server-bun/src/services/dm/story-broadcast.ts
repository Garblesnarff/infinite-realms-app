/**
 * #130: the live character sheet's invalidation signal for story appliers.
 *
 * Story damage, items, XP and rests are written server-side, out of combat, where no
 * `combat_state_updated` publish follows. The live sheet (CharacterContext)
 * only refreshes on the `combat-state-updated` window event (#2641), so
 * without this the sheet keeps the stale value until a hard reload — the
 * server had saved the new HP/XP/inventory, but nothing told the client.
 *
 * Each story applier calls `publishStoryCharacterUpdate` after its write, and
 * the session socket forwards `character_state_updated` as the
 * `character-state-updated` window event, which the character refresh hook
 * listens for. `broadcastToRoom` defers past an ambient DB transaction, so a
 * client's refetch always lands after the write commits.
 */
import { broadcastToRoom } from '../collaboration/room-manager.js';

export type StoryCharacterUpdateReason = 'story_damage' | 'story_items' | 'story_xp' | 'story_rest';

/** The socket message type the client maps to the `character-state-updated` window event. */
export const STORY_CHARACTER_UPDATED_MESSAGE = 'character_state_updated';

export function publishStoryCharacterUpdate(
  sessionId: string,
  reason: StoryCharacterUpdateReason,
): void {
  broadcastToRoom(sessionId, null as never, {
    type: STORY_CHARACTER_UPDATED_MESSAGE,
    reason,
    timestamp: Date.now(),
  });
}
