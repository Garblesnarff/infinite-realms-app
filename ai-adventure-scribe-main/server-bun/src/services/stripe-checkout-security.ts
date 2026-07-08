import { sql } from '../lib/db.js';
import { env } from '../lib/env.js';

export function getAllowedPricePlans(): ReadonlyMap<string, string> {
  return new Map([
    [env.STRIPE_PRICE_ID, 'pro'], [process.env.STRIPE_PRO_PRICE_ID, 'pro'],
    [process.env.STRIPE_ENTERPRISE_PRICE_ID, 'enterprise'],
  ].filter((entry): entry is [string, string] => Boolean(entry[0])));
}

export function getPlanFromPriceId(priceId: string | undefined): string {
  return (priceId && getAllowedPricePlans().get(priceId)) || 'free';
}

export function resolveAllowedPriceId(priceId: string | undefined): { priceId: string; plan: string } | null {
  const resolved = priceId || env.STRIPE_PRICE_ID;
  const plan = resolved ? getAllowedPricePlans().get(resolved) : undefined;
  return resolved && plan ? { priceId: resolved, plan } : null;
}

export function validateCheckoutUrl(value: string | undefined, fallbackPath: string): string {
  const appOrigin = process.env.APP_ORIGIN || 'https://infiniterealms.app';
  if (!value) return new URL(fallbackPath, appOrigin).toString();
  const allowedOrigins = new Set([new URL(appOrigin).origin, ...(process.env.STRIPE_CHECKOUT_ALLOWED_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean)]);
  const parsed = new URL(value);
  if (!allowedOrigins.has(parsed.origin)) throw new Error('Checkout redirect origin is not allowed');
  return parsed.toString();
}

export async function claimStripeEvent(eventId: string, eventType: string, insert: (id: string, type: string) => Promise<unknown[]> = async (id, type) => sql`
  INSERT INTO processed_stripe_events (event_id, event_type) VALUES (${id}, ${type})
  ON CONFLICT (event_id) DO NOTHING RETURNING event_id
`): Promise<boolean> {
  return (await insert(eventId, eventType)).length > 0;
}
