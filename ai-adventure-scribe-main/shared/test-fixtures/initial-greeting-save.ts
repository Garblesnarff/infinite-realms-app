/**
 * The opening scene as the client saves it to `POST /v1/sessions/:id/messages` (#2379).
 *
 * Shared on purpose (AGENTS.md §4). The game view can mount twice before the first greeting
 * lands, so two saves arrive for one new session, each under its own client-minted id. The
 * client test asserts the save queue sends exactly `INITIAL_GREETING_WIRE_BODY`; the server tests
 * post that same body, under two ids, through the real route schema and the real service.
 */

export const INITIAL_GREETING_TEXT =
  'Rain hammers the shutters of the Gilded Lantern as the last of the evening crowd drifts out into the mud. Behind the bar, a hooded stranger slides a folded map toward you and says nothing.\n\nA. **Take the map**, and read it by the fire.\nB. **Ask the stranger** who sent them.';

export const INITIAL_GREETING_TIMESTAMP = '2026-09-29T01:44:49.798Z';

/** Two mounts, two ids, one session: the ids the run 15 console showed (#2379). */
export const INITIAL_GREETING_IDS = [
  '9acfbdd8-9d02-4abe-b96a-932a7034d150',
  '7d819e08-4813-4448-9712-165cea5488be',
] as const;

/** The DM message the greeting hook hands to the save queue. */
export function initialGreetingMessage(id: string): {
  id: string;
  sender: 'dm';
  text: string;
  timestamp: string;
  context: { initialGreeting: true };
} {
  return {
    id,
    sender: 'dm' as const,
    text: INITIAL_GREETING_TEXT,
    timestamp: INITIAL_GREETING_TIMESTAMP,
    context: { initialGreeting: true },
  };
}

/** That message as the save queue posts it. */
export function initialGreetingWireBody(id: string): Record<string, unknown> {
  return {
    id,
    message: INITIAL_GREETING_TEXT,
    speaker_type: 'dm',
    context: {
      location: null,
      emotion: null,
      intent: null,
      handouts: null,
      combat_transition: null,
      scene_spec: false,
      combat_engine_blocks: null,
      combat_ended: false,
      narration_segments: null,
      initial_greeting: true,
    },
    timestamp: INITIAL_GREETING_TIMESTAMP,
  };
}
