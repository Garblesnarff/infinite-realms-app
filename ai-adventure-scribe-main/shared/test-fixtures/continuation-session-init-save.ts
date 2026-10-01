/**
 * What the client saves when a continuation session (`session_number > 1`) opens (#2386).
 *
 * Shared on purpose (AGENTS.md §4). The game view can mount twice before the first greeting
 * lands, and each mount saves the "Previously On" recap to `POST /v1/sessions/:id/messages` and
 * the opening memories to `POST /v1/memories`, each under ids the server did not choose. The
 * client tests assert the real producers emit exactly these bodies (`use-initial-greeting.ts` +
 * the save queue for the recap, `createInitialMemories` for the memories); the server tests post
 * the same bodies through the real route schema and the real services.
 */

export const PREVIOUSLY_ON_TEXT =
  'Previously, on your adventure in The Gilded Lantern, Mira followed a hooded stranger through the rain and learned the map leads beneath the old mill.';

export const PREVIOUSLY_ON_TIMESTAMP = '2026-09-30T08:15:00.000Z';

/** Two mounts, two ids, one session. */
export const PREVIOUSLY_ON_IDS = [
  '3f1f6c0e-5c2b-4d44-a3f4-0b6f1f0d8a11',
  '8d0a2b77-91c4-4d7e-8a5e-7f3b2c6e9d22',
] as const;

/** The DM message `use-initial-greeting.ts` hands to the save queue for the recap. */
export function previouslyOnMessage(id: string): {
  id: string;
  sender: 'dm';
  text: string;
  timestamp: string;
  context: { previouslyOn: true };
} {
  return {
    id,
    sender: 'dm' as const,
    text: PREVIOUSLY_ON_TEXT,
    timestamp: PREVIOUSLY_ON_TIMESTAMP,
    context: { previouslyOn: true },
  };
}

/** That message as the save queue posts it. */
export function previouslyOnWireBody(id: string): Record<string, unknown> {
  return {
    id,
    message: PREVIOUSLY_ON_TEXT,
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
      previously_on: true,
    },
    timestamp: PREVIOUSLY_ON_TIMESTAMP,
  };
}

/** The opening scene of the continuation session; its second sentence is the atmosphere memory. */
export const CONTINUATION_GREETING_TEXT =
  'You wake in the loft of the Gilded Lantern. The air smells of wet wool and woodsmoke, and the map lies where you left it.';

export const CONTINUATION_CHARACTER = {
  id: 'c0a8f2d4-0000-4000-8000-000000000001',
  name: 'Mira',
  race: { name: 'Human' },
  class: { name: 'Rogue' },
  level: 2,
  background: { name: 'Urchin' },
};

export const CONTINUATION_CAMPAIGN = {
  id: 'c0a8f2d4-0000-4000-8000-000000000002',
  name: 'The Gilded Lantern',
  description: 'A rain-soaked inn hides the first clue to a buried vault.',
};

/**
 * The four foundational memories `createInitialMemories` hands to `onMemoryCreated` for that
 * greeting, which `useMemoryCreation` posts to `/v1/memories` (one record per request) with
 * `session_id` set. Each session writes the set once per mount.
 */
export function initialMemoryWireBodies(sessionId: string): Array<Record<string, unknown>> {
  return [
    {
      session_id: sessionId,
      type: 'character_moment',
      subcategory: 'player',
      content: 'Mira, a Human Rogue of level 2, begins their adventure. Background: Urchin.',
      importance: 9,
      metadata: {
        character_id: CONTINUATION_CHARACTER.id,
        character_name: 'Mira',
        is_player_character: true,
        is_initial_memory: true,
      },
    },
    {
      session_id: sessionId,
      type: 'world_detail',
      subcategory: 'general',
      content:
        'Campaign: The Gilded Lantern. A rain-soaked inn hides the first clue to a buried vault.',
      importance: 7,
      metadata: {
        campaign_id: CONTINUATION_CAMPAIGN.id,
        campaign_name: 'The Gilded Lantern',
        is_initial_memory: true,
      },
    },
    {
      session_id: sessionId,
      type: 'location',
      subcategory: 'current_location',
      content: `Opening Scene: ${CONTINUATION_GREETING_TEXT}`,
      importance: 7,
      metadata: { scene_type: 'opening', is_initial_memory: true, turn_count: 0 },
    },
    {
      session_id: sessionId,
      type: 'atmosphere',
      subcategory: 'environment',
      content:
        'Initial atmosphere: The air smells of wet wool and woodsmoke, and the map lies where you left it.',
      importance: 5,
      metadata: { scene_type: 'opening', is_initial_memory: true },
    },
  ];
}
