import { beforeAll, describe, expect, it, vi } from 'vitest';

import type * as Billing from '../../../services/stripe-checkout-security.js';

let billing: typeof Billing;

beforeAll(async () => {
  Object.assign(process.env, {
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    PORT: '3000',
    CORS_ORIGIN: 'http://localhost:5173',
    WORKOS_API_KEY: 'test',
    WORKOS_CLIENT_ID: 'test',
    STRIPE_PRICE_ID: 'price_pro',
    STRIPE_PRO_PRICE_ID: 'price_pro',
    STRIPE_ENTERPRISE_PRICE_ID: 'price_enterprise',
    APP_ORIGIN: 'https://infiniterealms.app',
  });
  billing = await import('../../../services/stripe-checkout-security.js');
});

describe('billing hardening', () => {
  it('rejects a client-supplied unknown price ID', () => {
    expect(billing.resolveAllowedPriceId('price_attacker')).toBeNull();
    expect(billing.resolveAllowedPriceId('price_pro')).toEqual({
      priceId: 'price_pro',
      plan: 'pro',
    });
  });

  it('maps the configured enterprise price to the enterprise plan', () => {
    expect(billing.getPlanFromPriceId('price_enterprise')).toBe('enterprise');
    expect(billing.resolveAllowedPriceId('price_enterprise')).toEqual({
      priceId: 'price_enterprise',
      plan: 'enterprise',
    });
    expect(billing.getPlanFromPriceId('price_unknown')).toBe('free');
  });

  it('rejects checkout redirects outside the configured origin', () => {
    expect(() =>
      billing.validateCheckoutUrl('https://evil.example/paid', '/app/account'),
    ).toThrow();
  });

  it('skips duplicate webhook events', async () => {
    const insert = vi.fn().mockResolvedValue([]);
    await expect(
      billing.claimStripeEvent('evt_1', 'checkout.session.completed', insert),
    ).resolves.toBe(false);
    expect(insert).toHaveBeenCalledOnce();
  });
});
