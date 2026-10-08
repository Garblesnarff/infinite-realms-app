/**
 * The exact bodies the client posts for in-session voice and scene images, and the same calls
 * with no session (#2269, #2270). The server writes `ai_usage.session_id` from `sessionId`
 * (#2242), so a client that leaves it out leaves the dollar row null.
 *
 * Shared on purpose (AGENTS.md §4, pattern #2286). The client tests assert the code sends exactly
 * these bodies; the server tests post the same bodies through the real routes and assert the usage
 * row. A body one side changes and the other does not fails a test on one side.
 *
 * Portraits and campaign covers have no session, so their bodies carry no `sessionId` key.
 */

export const COST_SESSION_ID = '5d3c1f0a-2269-4270-9b7e-8c4a61e0d2f3';

export const COST_VOICE_ID = 'T0GKiSwCb51L7pv1sshd';

export const COST_VOICE_TEXT = 'The lantern flickers as the door creaks open.';

export const COST_VOICE_SETTINGS = { stability: 0.5, similarity_boost: 0.75 };

export const COST_IMAGE_PROMPT = 'A lantern-lit corridor in the old academy';

export const COST_IMAGE_MODEL = 'google/gemini-2.5-flash-image';

/** Base64 of "hello": a reference image the client sends alongside the prompt. */
export const COST_IMAGE_REFERENCE = 'aGVsbG8=';

export interface CostWireCase {
  name: string;
  /** Path the client posts to. */
  path: string;
  /** The session id the usage row must carry, or null when the body has none. */
  expectedSessionId: string | null;
  /** The body as it arrives over the wire (JSON.stringify drops undefined keys). */
  wireBody: Record<string, unknown>;
}

const voicePath = `/v1/ai-proxy/voice/${COST_VOICE_ID}`;

const voiceBody = {
  text: COST_VOICE_TEXT,
  model_id: 'eleven_flash_v2_5',
  voice_settings: COST_VOICE_SETTINGS,
};

const imageBody = {
  prompt: COST_IMAGE_PROMPT,
  model: COST_IMAGE_MODEL,
  referenceImages: [COST_IMAGE_REFERENCE],
};

export const VOICE_IN_SESSION: CostWireCase = {
  name: 'in-session voice',
  path: voicePath,
  expectedSessionId: COST_SESSION_ID,
  wireBody: { ...voiceBody, sessionId: COST_SESSION_ID },
};

export const VOICE_WITHOUT_SESSION: CostWireCase = {
  name: 'voice with no session',
  path: voicePath,
  expectedSessionId: null,
  wireBody: { ...voiceBody },
};

export const SCENE_IMAGE_IN_SESSION: CostWireCase = {
  name: 'scene image',
  path: '/v1/images/generate',
  expectedSessionId: COST_SESSION_ID,
  wireBody: { ...imageBody, sessionId: COST_SESSION_ID },
};

export const PORTRAIT_IMAGE_WITHOUT_SESSION: CostWireCase = {
  name: 'portrait or campaign cover (no session)',
  path: '/v1/images/generate',
  expectedSessionId: null,
  wireBody: { ...imageBody },
};

export const COST_WIRE_CASES: CostWireCase[] = [
  VOICE_IN_SESSION,
  VOICE_WITHOUT_SESSION,
  SCENE_IMAGE_IN_SESSION,
  PORTRAIT_IMAGE_WITHOUT_SESSION,
];
