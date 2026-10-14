import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildWaitlistJoinRequest } from '../waitlist-join-request';

describe('SSR waitlist form', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('posts the request buildWaitlistJoinRequest builds', async () => {
    document.body.innerHTML = `
      <form data-waitlist-form data-source="ai-gm-hero">
        <input type="email" />
        <button type="submit">Join</button>
        <p data-form-message></p>
      </form>
    `;
    const emailInput = document.querySelector<HTMLInputElement>('input[type="email"]');
    if (!emailInput) throw new Error('email input missing');
    emailInput.value = 'Player@example.com';

    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify({ success: true }), { status: 201 });
      }),
    );

    const { initWaitlistForms } = await import('../../landing-client');
    initWaitlistForms();
    document
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(calls).toHaveLength(1);
    });

    const join = buildWaitlistJoinRequest({
      email: 'Player@example.com',
      source: 'ai-gm-hero',
    });
    expect(calls[0]?.url).toBe(join.path);
    expect(calls[0]?.init.method).toBe(join.method);
    expect(calls[0]?.init.headers).toEqual(join.headers);
    expect(calls[0]?.init.body).toBe(JSON.stringify(join.body));
  });
});
