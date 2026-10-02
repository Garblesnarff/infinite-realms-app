import { render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it } from 'vitest';

import App from '@/App';

describe('App mounts the legal routes (#2258)', () => {
  it.each([
    ['/privacy', 'Privacy Policy'],
    ['/terms', 'Terms of Service'],
    ['/cookies', 'Cookie Notice'],
    ['/contact', 'Contact'],
  ])('%s renders its heading through the real App router', async (path, heading) => {
    window.history.pushState({}, '', path);
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });
});
