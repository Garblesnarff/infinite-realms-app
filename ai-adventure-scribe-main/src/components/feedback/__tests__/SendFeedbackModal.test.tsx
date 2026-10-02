import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { feedbackWireBody, versionBody } from '../../../../shared/test-fixtures/feedback-wire-body';
import { SendFeedbackButton } from '../SendFeedbackButton';


const fetchWithAuth = vi.fn();
vi.mock('@/infrastructure/api/rest-client', () => ({
  fetchWithAuth: (...args: unknown[]) => fetchWithAuth(...args),
}));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function renderButton() {
  return render(
    <MemoryRouter initialEntries={[feedbackWireBody.page]}>
      <SendFeedbackButton
        campaignSlug={feedbackWireBody.campaignSlug}
        sessionId={feedbackWireBody.sessionId}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  fetchWithAuth.mockReset();
  fetchWithAuth.mockImplementation(async (path: string) =>
    path === '/version' ? jsonResponse(versionBody) : jsonResponse({ success: true }, 201),
  );
});

describe('SendFeedbackButton / modal', () => {
  it('opens the modal with a disabled Send button until there is text', () => {
    renderButton();
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('posts message, page, build, campaign and session, then shows thanks', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    fireEvent.change(screen.getByLabelText('Your feedback'), {
      target: { value: `  ${feedbackWireBody.message}  ` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await screen.findByRole('status');
    const post = fetchWithAuth.mock.calls.find(([path]) => path === '/v1/feedback');
    expect(post).toBeTruthy();
    expect(post![1].method).toBe('POST');
    expect(JSON.parse(post![1].body)).toEqual(feedbackWireBody);
  });

  it('shows an error and keeps the text when the server rejects it', async () => {
    fetchWithAuth.mockImplementation(async (path: string) =>
      path === '/version' ? jsonResponse(versionBody) : jsonResponse({ error: 'x' }, 429),
    );
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Too many messages');
    expect((screen.getByLabelText('Your feedback') as HTMLTextAreaElement).value).toBe('hello');
  });

  it('still sends when /version is unreachable', async () => {
    fetchWithAuth.mockImplementation(async (path: string) => {
      if (path === '/version') throw new Error('offline');
      return jsonResponse({ success: true }, 201);
    });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Send feedback' }));
    fireEvent.change(screen.getByLabelText('Your feedback'), { target: { value: 'hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(screen.getByRole('status')).toBeTruthy());
    const post = fetchWithAuth.mock.calls.find(([path]) => path === '/v1/feedback')!;
    expect(typeof JSON.parse(post[1].body).build).toBe('string');
  });
});
