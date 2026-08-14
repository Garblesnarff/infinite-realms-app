import { describe, expect, it } from 'bun:test';

import { decodeWsFrame, WsFrameDecodeError } from '../collaboration/ws-frame.js';

describe('decodeWsFrame', () => {
  describe('frames a healthy client actually sends', () => {
    it('accepts the pre-parsed object Elysia hands the message handler', () => {
      // Every client sender uses JSON.stringify({...}), and Elysia's
      // createWSMessageParser JSON.parses any frame starting with "{" before
      // our handler runs. This is the shape that used to throw on every turn.
      const parsedByElysia = { type: 'chat', text: 'I punch the dishwasher' };

      expect(decodeWsFrame(parsedByElysia)).toEqual({
        type: 'chat',
        text: 'I punch the dishwasher',
      });
    });

    it('does not stringify the object into "[object Object]"', () => {
      // Regression guard for the exact prod failure: JSON.parse(String(obj))
      // throws SyntaxError: JSON Parse error: Unexpected identifier "object".
      expect(() => decodeWsFrame({ type: 'scene:update', sceneId: 'abc' })).not.toThrow();
    });

    it('accepts a raw JSON string frame', () => {
      expect(decodeWsFrame('{"type":"chat","text":"hi"}')).toEqual({ type: 'chat', text: 'hi' });
    });

    it('tolerates surrounding whitespace in a text frame', () => {
      expect(decodeWsFrame('  {"type":"chat"}\n')).toEqual({ type: 'chat' });
    });

    it('accepts a binary frame carrying UTF-8 JSON', () => {
      const bytes = new TextEncoder().encode('{"type":"chat","text":"binary"}');

      expect(decodeWsFrame(bytes)).toEqual({ type: 'chat', text: 'binary' });
      expect(decodeWsFrame(bytes.buffer)).toEqual({ type: 'chat', text: 'binary' });
    });

    it('preserves non-ASCII payloads through the binary path', () => {
      const bytes = new TextEncoder().encode('{"type":"chat","text":"soufflé ⚔️"}');

      expect(decodeWsFrame(bytes)).toEqual({ type: 'chat', text: 'soufflé ⚔️' });
    });
  });

  describe('frames that are genuinely malformed still error', () => {
    it('throws on truncated JSON text', () => {
      expect(() => decodeWsFrame('{"type":"chat"')).toThrow(WsFrameDecodeError);
    });

    it('throws on non-JSON text', () => {
      expect(() => decodeWsFrame('hello there')).toThrow(WsFrameDecodeError);
    });

    it('throws on an empty or whitespace-only frame', () => {
      expect(() => decodeWsFrame('')).toThrow(WsFrameDecodeError);
      expect(() => decodeWsFrame('   ')).toThrow(WsFrameDecodeError);
    });

    it('throws on primitives Elysia coerced from bare text frames', () => {
      // Elysia turns "123"/"true"/"null" into 123/true/null before we see them.
      expect(() => decodeWsFrame(123)).toThrow(WsFrameDecodeError);
      expect(() => decodeWsFrame(true)).toThrow(WsFrameDecodeError);
      expect(() => decodeWsFrame(null)).toThrow(WsFrameDecodeError);
      expect(() => decodeWsFrame(undefined)).toThrow(WsFrameDecodeError);
    });

    it('throws on a JSON array, which is not a protocol message', () => {
      expect(() => decodeWsFrame([{ type: 'chat' }])).toThrow(WsFrameDecodeError);
      expect(() => decodeWsFrame('[1,2,3]')).toThrow(WsFrameDecodeError);
    });

    it('throws on binary that is not valid UTF-8 JSON', () => {
      expect(() => decodeWsFrame(new Uint8Array([0xff, 0xfe, 0x00]))).toThrow(WsFrameDecodeError);
    });
  });
});
