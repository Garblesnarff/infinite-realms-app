import crypto from 'crypto';

/**
 * Short-lived, one-time WebSocket tickets.
 *
 * WorkOS access tokens must not appear in the `/ws` query string (nginx error
 * logs always print `$request` including args). The client mints a ticket over
 * a normal authenticated POST, then connects with `?ticket=…`. Consume burns
 * the ticket so a logged query string cannot be replayed.
 */

export const WS_TICKET_TTL_MS = 30_000;
export const WS_UNAUTHORIZED_CLOSE_MS = 5_000;

export interface WsTicketRecord {
  userId: string;
  email?: string;
  sessionId: string;
  expiresAt: number;
}

export interface MintedWsTicket {
  ticket: string;
  expiresInMs: number;
}

const tickets = new Map<string, WsTicketRecord>();

function sweepExpired(now: number): void {
  for (const [ticket, record] of tickets) {
    if (record.expiresAt <= now) tickets.delete(ticket);
  }
}

export function mintWsTicket(input: {
  userId: string;
  email?: string;
  sessionId: string;
  now?: number;
}): MintedWsTicket {
  const now = input.now ?? Date.now();
  sweepExpired(now);

  const ticket = crypto.randomBytes(32).toString('base64url');
  tickets.set(ticket, {
    userId: input.userId,
    email: input.email,
    sessionId: input.sessionId,
    expiresAt: now + WS_TICKET_TTL_MS,
  });

  return { ticket, expiresInMs: WS_TICKET_TTL_MS };
}

/**
 * Look up and immediately burn a ticket. Missing, expired, and already-used
 * tickets all return null so a replay cannot join a room.
 */
export function consumeWsTicket(ticket: string, now = Date.now()): WsTicketRecord | null {
  const record = tickets.get(ticket);
  if (!record) return null;
  tickets.delete(ticket);
  if (record.expiresAt <= now) return null;
  return record;
}

export function resetWsTicketsForTests(): void {
  tickets.clear();
}
