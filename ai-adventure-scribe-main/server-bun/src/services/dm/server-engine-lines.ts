/**
 * #1597: `engine_lines` is owned by the server. The model never supplies it. The server sets it
 * on the envelope when the engine resolved something this turn (a typed Lay on Hands), and the
 * client counts it as an engine event, so the narration gate does not replace the reply.
 *
 * The strip runs on every parsed model envelope, as #1062 does for `story_trackers`. The carry
 * runs where the combat-entry seating path re-parses the reply text, which would otherwise drop
 * the server's lines.
 */

type Envelope = Record<string, unknown>;

/** Remove any model-supplied `engine_lines`. Called once, on the parsed model envelope. */
export function stripModelEngineLines(envelope: Envelope): void {
  delete envelope.engine_lines;
}

/** Set the engine lines the server resolved this turn; no lines leaves the field absent. */
export function setServerEngineLines(envelope: Envelope, lines: readonly string[]): void {
  if (lines.length > 0) envelope.engine_lines = [...lines];
  else delete envelope.engine_lines;
}

/** Copy the server's lines from `served` onto a re-parsed envelope; drop any stale value. */
export function carryServerEngineLines(
  served: Envelope | null | undefined,
  target: Envelope,
): void {
  const lines = served?.engine_lines;
  if (Array.isArray(lines) && lines.length > 0) target.engine_lines = lines;
  else delete target.engine_lines;
}
