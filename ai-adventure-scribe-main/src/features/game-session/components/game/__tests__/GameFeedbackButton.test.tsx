import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { GameFeedbackButton } from '../game-content/GameFeedbackButton';

const fetchWithAuth = vi.fn(async (path: string) =>
  path === '/version'
    ? new Response(JSON.stringify({ short: 'abc12345' }), { status: 200 })
    : new Response('{}', { status: 201 }),
);
vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: (...args: [string]) => fetchWithAuth(...args),
}));

describe('GameFeedbackButton', () => {
  it('sends the campaign from the route and the session from ?session=', async () => {
    render(
      <MemoryRouter initialEntries={['/app/game/camp-7?session=s-1&character=c-1']}>
        <Routes>
          <Route path="/app/game/:id" element={<GameFeedbackButton />} />
        </Routes>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'bug' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());

    const post = (fetchWithAuth.mock.calls as unknown as Array<[string, RequestInit]>).find(
      ([path]) => path === '/v1/feedback',
    )!;
    expect(JSON.parse(post[1].body as string)).toMatchObject({
      campaignSlug: 'camp-7',
      sessionId: 's-1',
      page: '/app/game/camp-7',
      build: 'abc12345',
    });
  });
});
