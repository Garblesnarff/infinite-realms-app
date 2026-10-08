/**
 * Characterization of where the blog admin token lives after login (#2673 step 2a).
 *
 * Documents current behavior, including the weakness the issue describes; it
 * does not assert that the behavior is right. Step 2b changes storage and will
 * flip the assertions. The token is an obviously fake string and is never
 * printed: the test checks key names only.
 */
import { render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BlogAdminLogin from '../BlogAdminLogin';

const storageKeys = (storage: Storage): string[] =>
  Array.from({ length: storage.length }, (_, index) => storage.key(index) ?? '').sort();

describe('BlogAdminLogin token storage (#2673 step 2a characterization)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    // Same shape as the server's POST /v1/blog-admin/login success response
    // (server-bun/src/routes/blog-admin-auth.ts), with a fake token.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ success: true, token: 'test-blog-admin-token' }),
      } as Response),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('documents #2673 P1: blog admin login leaves the JWT in sessionStorage, readable by any page script', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <MemoryRouter initialEntries={['/admin/blog/login']}>
        <BlogAdminLogin />
      </MemoryRouter>,
    );

    await user.type(container.querySelector('#username') as HTMLInputElement, 'test-admin');
    await user.type(container.querySelector('#password') as HTMLInputElement, 'test-password');
    await user.click(container.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(storageKeys(window.sessionStorage)).toEqual(['blog_admin_token']));

    expect(storageKeys(window.localStorage)).toEqual([]);
  });
});
