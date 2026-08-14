/**
 * WebSocket inbound frame decoding.
 *
 * Elysia's `createWSMessageParser` already deserializes incoming frames before
 * handing them to our `message` handler: any string frame whose first character
 * is `"`, `/`, `[` or `{` is run through `JSON.parse`, and bare `true`/`false`/
 * `null`/numeric strings are coerced to their primitive. Every frame our clients
 * send is `JSON.stringify(...)` of an object, so by the time it reaches us it is
 * already a plain object.
 *
 * Re-parsing that object stringifies it to "[object Object]" first, which throws
 * `SyntaxError: JSON Parse error: Unexpected identifier "object"` on every single
 * message. See #1788.
 *
 * This module normalizes the several shapes a frame can legitimately arrive in
 * and reserves throwing for frames that are genuinely undecodable.
 */

/** Raised for frames that are not decodable into a protocol message object. */
export class WsFrameDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WsFrameDecodeError';
  }
}

function isBinaryFrame(frame: unknown): frame is ArrayBufferView | ArrayBuffer {
  return ArrayBuffer.isView(frame) || frame instanceof ArrayBuffer;
}

function parseJsonText(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new WsFrameDecodeError('Empty WebSocket frame');
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new WsFrameDecodeError(
      `WebSocket frame is not valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/**
 * Decode an inbound WebSocket frame into the message object our handlers expect.
 *
 * Accepts the already-parsed object Elysia hands us, a raw JSON string (which is
 * what we get when Elysia's own parse failed or the frame did not look like
 * JSON), or a binary frame. Throws {@link WsFrameDecodeError} for anything that
 * cannot be decoded into an object, so genuinely malformed traffic still
 * surfaces as an error.
 */
export function decodeWsFrame(frame: unknown): Record<string, unknown> {
  if (frame === null || frame === undefined) {
    throw new WsFrameDecodeError('WebSocket frame is empty');
  }

  // Binary frames: decode as UTF-8 JSON text.
  if (isBinaryFrame(frame)) {
    const bytes = ArrayBuffer.isView(frame)
      ? new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength)
      : new Uint8Array(frame);
    return assertMessageObject(parseJsonText(new TextDecoder().decode(bytes)));
  }

  // Text frames Elysia left alone (its parse failed, or it did not look like JSON).
  if (typeof frame === 'string') {
    return assertMessageObject(parseJsonText(frame));
  }

  // The normal path: Elysia already parsed the JSON for us.
  if (typeof frame === 'object') {
    return assertMessageObject(frame);
  }

  throw new WsFrameDecodeError(`Unsupported WebSocket frame type: ${typeof frame}`);
}

function assertMessageObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || isBinaryFrame(value)) {
    throw new WsFrameDecodeError('WebSocket frame did not decode to a message object');
  }
  return value as Record<string, unknown>;
}
