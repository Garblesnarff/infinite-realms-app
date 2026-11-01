import { describe, expect, test } from 'bun:test';

import { joinRoom, leaveRoom } from '../../collaboration/room-manager.js';
import { DM_FALLBACK_PERSISTED_MESSAGE, publishDmFallbackRow } from '../dm-fallback-broadcast.js';

// #800 item 3: the fallback row reaches live tabs over the session socket room.
// Fake WS connections against the real room manager — no database involved.
function fakeClient(): { ws: never; sent: string[] } {
  const sent: string[] = [];
  const ws = {
    data: { user: { userId: 'user-1', email: '' }, roomId: 'session-1', requestId: 'r1' },
    send: (message: string | Buffer) => {
      sent.push(String(message));
    },
    close: () => {},
    readyState: 1,
  } as never;
  return { ws, sent };
}

describe('publishDmFallbackRow', () => {
  test('every open client in the session room receives the fallback frame', () => {
    const a = fakeClient();
    const b = fakeClient();
    joinRoom('session-1', a.ws);
    joinRoom('session-1', b.ws);
    try {
      publishDmFallbackRow({
        sessionId: 'session-1',
        messageId: 'dm-1',
        rollRequests: [{ type: 'check', purpose: 'Stay conscious' }],
      });
      expect(a.sent).toHaveLength(1);
      expect(b.sent).toHaveLength(1);
      const frame = JSON.parse(a.sent[0] as string) as Record<string, unknown>;
      expect(frame.type).toBe(DM_FALLBACK_PERSISTED_MESSAGE);
      expect(frame.sessionId).toBe('session-1');
      expect(frame.messageId).toBe('dm-1');
      expect(frame.rollRequests).toEqual([{ type: 'check', purpose: 'Stay conscious' }]);
      expect(typeof frame.timestamp).toBe('number');
      expect(frame).not.toHaveProperty('message');
    } finally {
      leaveRoom('session-1', a.ws);
      leaveRoom('session-1', b.ws);
    }
  });

  test('clients in other rooms and closed sockets receive nothing', () => {
    const other = fakeClient();
    const closed = fakeClient();
    (closed.ws as { readyState: number }).readyState = 3;
    joinRoom('session-2', other.ws);
    joinRoom('session-1', closed.ws);
    try {
      publishDmFallbackRow({ sessionId: 'session-1', messageId: 'dm-1', rollRequests: [] });
      expect(other.sent).toHaveLength(0);
      expect(closed.sent).toHaveLength(0);
    } finally {
      leaveRoom('session-2', other.ws);
      leaveRoom('session-1', closed.ws);
    }
  });

  test('no room means no throw', () => {
    expect(() =>
      publishDmFallbackRow({ sessionId: 'no-such-session', messageId: 'dm-1', rollRequests: [] }),
    ).not.toThrow();
  });
});
