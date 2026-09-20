import { afterEach, describe, expect, it } from 'bun:test';

import { rooms } from '../services/collaboration/room-manager.js';
import { mintWsTicket, resetWsTicketsForTests } from '../services/ws-ticket.js';
import { openWsConnection, type WsUpgradeSocket } from '../ws.js';

function fakeSocket(query: WsUpgradeSocket['data']['query'] = {}): WsUpgradeSocket & {
  sent: string[];
  closed: { code?: number; reason?: string } | null;
} {
  const socket: WsUpgradeSocket & {
    sent: string[];
    closed: { code?: number; reason?: string } | null;
  } = {
    data: { query },
    sent: [],
    closed: null,
    send(message: string) {
      socket.sent.push(message);
    },
    close(code?: number, reason?: string) {
      socket.closed = { code, reason };
    },
  };
  return socket;
}

afterEach(() => {
  resetWsTicketsForTests();
  rooms.clear();
});

describe('WebSocket upgrade tickets', () => {
  it('closes a connection without a ticket within 5s and does not join a room', async () => {
    const ws = fakeSocket({});
    const started = Date.now();
    await openWsConnection(ws);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(ws.closed?.code).toBe(4000);
    expect(ws.sent).toEqual([]);
    expect(rooms.get('lobby')?.size ?? 0).toBe(0);
  });

  it('joins the ticket room and sends welcome when the ticket is valid', async () => {
    const { ticket } = mintWsTicket({ userId: 'user-1', email: 'a@b.test', sessionId: 'lobby' });
    const ws = fakeSocket({ ticket });
    await openWsConnection(ws);
    expect(ws.closed).toBeNull();
    expect(ws.data.roomId).toBe('lobby');
    expect(ws.data.user?.userId).toBe('user-1');
    expect(rooms.get('lobby')?.has(ws as never)).toBe(true);
    const welcome = JSON.parse(ws.sent[0] ?? '{}') as { type?: string; sessionId?: string };
    expect(welcome.type).toBe('welcome');
    expect(welcome.sessionId).toBe('lobby');
  });

  it('closes a reused ticket within 5s and does not join a second time', async () => {
    const { ticket } = mintWsTicket({ userId: 'user-1', sessionId: 'lobby' });
    const first = fakeSocket({ ticket });
    await openWsConnection(first);
    expect(first.closed).toBeNull();
    expect(rooms.get('lobby')?.size ?? 0).toBe(1);

    const started = Date.now();
    const second = fakeSocket({ ticket });
    await openWsConnection(second);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(second.closed?.code).toBe(4000);
    expect(second.sent).toEqual([]);
    expect(rooms.get('lobby')?.size ?? 0).toBe(1);
    expect(rooms.get('lobby')?.has(first as never)).toBe(true);
  });
});
