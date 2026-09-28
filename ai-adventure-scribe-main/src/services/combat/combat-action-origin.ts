import type { MessageSendContext } from '@/features/game-session/components/chat/MessageList';

/**
 * Who produced a combat action (#2305).
 *
 * The rule: the player's character acts only on this turn's player input — a typed message, the
 * sheet's Cast, the ActionBar, or the die the player rolled. The DM's own output and the repair
 * loop never act for the player, and a replayed send is collapsed before it becomes a turn
 * (`use-message-send-queue`). In run M7 round 2 the engine cast Chill
 * Touch for the player on a turn the player never took; every intent then said `source: 'dm'`,
 * the player's real casts included, so nothing could tell the two apart.
 *
 * Mirrors `COMBAT_ACTION_ORIGINS` in `server-bun/src/routes/v1/combat/intent-schema.ts`.
 */
export type PlayerInputOrigin = 'typed' | 'sheet_cast' | 'action_bar' | 'dice_roll';
export type CombatActionOrigin = PlayerInputOrigin | 'dm' | 'repair';

const PLAYER_INPUT_ORIGINS = new Set<CombatActionOrigin>([
  'typed',
  'sheet_cast',
  'action_bar',
  'dice_roll',
]);

export const isPlayerInputOrigin = (origin: CombatActionOrigin): origin is PlayerInputOrigin =>
  PLAYER_INPUT_ORIGINS.has(origin);

/**
 * The origin of the message that started this turn, or `null` when no player message did.
 * Only a player's own message is input; anything else that reaches the DM is not.
 */
export function playerInputOriginOf(
  message:
    | {
        sender?: string;
        context?: (Partial<MessageSendContext> & { intent?: string; origin?: string }) | null;
      }
    | null
    | undefined,
): PlayerInputOrigin | null {
  if (!message || message.sender !== 'player') return null;
  const origin = message.context?.origin;
  if (origin === 'action_bar') return 'action_bar';
  if (message.context?.intent === 'spell_cast') return 'sheet_cast';
  if (message.context?.intent === 'dice_roll') return 'dice_roll';
  return 'typed';
}
