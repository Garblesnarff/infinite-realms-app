import { afterEach, describe, expect, it } from 'bun:test';

import {
  consumeWsTicket,
  mintWsTicket,
  resetWsTicketsForTests,
  WS_TICKET_TTL_MS,
} from '../ws-ticket.js';

afterEach(() => {
  resetWsTicketsForTests();
});

describe('ws tickets', () => {
  it('mints a ticket that can be consumed once', () => {
    const minted = mintWsTicket({ userId: 'user-1', email: 'a@b.test', sessionId: 'sess-1' });
    expect(minted.expiresInMs).toBe(WS_TICKET_TTL_MS);
    expect(minted.ticket.length).toBeGreaterThan(20);

    const record = consumeWsTicket(minted.ticket);
    expect(record).toEqual({
      userId: 'user-1',
      email: 'a@b.test',
      sessionId: 'sess-1',
      expiresAt: expect.any(Number),
    });
  });

  it('rejects a reused ticket', () => {
    const { ticket } = mintWsTicket({ userId: 'user-1', sessionId: 'lobby' });
    expect(consumeWsTicket(ticket)).not.toBeNull();
    expect(consumeWsTicket(ticket)).toBeNull();
  });

  it('rejects an expired ticket', () => {
    const now = 1_000_000;
    const { ticket } = mintWsTicket({ userId: 'user-1', sessionId: 'lobby', now });
    expect(consumeWsTicket(ticket, now + WS_TICKET_TTL_MS + 1)).toBeNull();
  });

  it('rejects a missing ticket', () => {
    expect(consumeWsTicket('no-such-ticket')).toBeNull();
  });
});
