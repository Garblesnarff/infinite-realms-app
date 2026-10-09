import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes, matchRoutes, useLocation, useRoutes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { getAppRoutes } from '../app-routes';

import { CAMPAIGN_HUB_TABS } from '@/pages/campaigns/CampaignHubTabsList';

/**
 * #2155: in-app links pointed at /app/campaigns, which had no route, and the
 * /app/* subtree had no catch-all, so they rendered a blank page. These tests
 * scan src/ for every '/app…' literal and check it lands on a real page.
 */

const SRC_ROOT = join(__dirname, '..', '..');
// Stands in for a `${…}` interpolation: an id, or a value we cannot know statically.
const DYN = '__dyn__';

interface LinkTarget {
  path: string;
  where: string;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return name === '__tests__' || name === 'test' ? [] : sourceFiles(full);
    }
    if (!/\.tsx?$/.test(name) || /\.(test|spec)\.tsx?$/.test(name) || name.startsWith('._')) {
      return [];
    }
    return [full];
  });
}

function collectAppLinkTargets(): LinkTarget[] {
  const literal = /`(\/app(?:[/?#][^`]*)?)`|'(\/app(?:[/?#][^']*)?)'|"(\/app(?:[/?#][^"]*)?)"/g;
  const targets: LinkTarget[] = [];
  for (const file of sourceFiles(SRC_ROOT)) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return; // comments are not links
      for (const m of line.matchAll(literal)) {
        const raw = m[1] ?? m[2] ?? m[3];
        if (raw === '/app/*') continue; // the mount point in App.tsx, not a link
        const path = raw.replace(/\$\{[^}]*\}/g, DYN).split(/[?#]/)[0];
        targets.push({ path, where: `${relative(SRC_ROOT, file)}:${i + 1}` });
      }
    });
  }
  return targets;
}

/** Returns why `appPath` would not reach a real page, or null when it does. */
function unresolvedReason(appPath: string): string | null {
  const pathname = appPath.replace(/^\/app/, '') || '/';
  const matches = matchRoutes(getAppRoutes(), pathname);
  const leaf = matches?.[matches.length - 1];
  if (!leaf) return 'matches no route';
  if (leaf.route.path === '*') return 'falls through to the not-found catch-all';
  if (leaf.route.path === '/campaigns/:id/*') {
    const tab = (leaf.params['*'] ?? '').split('/')[0];
    if (tab && tab !== DYN && !CAMPAIGN_HUB_TABS.has(tab)) {
      return `lands on the campaign hub, which has no "${tab}" tab`;
    }
  }
  return null;
}

describe('/app route table (#2155)', () => {
  const targets = collectAppLinkTargets();

  it('finds the in-app link targets it is meant to check', () => {
    // Guards against the scan silently matching nothing after a refactor.
    expect(targets.length).toBeGreaterThan(40);
    expect(targets.map((t) => t.path)).toContain('/app/characters');
  });

  it('every /app/… path referenced in src/ resolves to a defined route', () => {
    const broken = targets
      .map((t) => ({ ...t, reason: unresolvedReason(t.path) }))
      .filter((t) => t.reason !== null)
      .map((t) => `${t.where} → ${t.path} ${t.reason}`);
    expect(broken).toEqual([]);
  });

  it('flags the targets that were broken before #2155', () => {
    expect(unresolvedReason('/app/home')).toBe('falls through to the not-found catch-all');
    expect(unresolvedReason(`/app/campaigns/${DYN}/scenes/${DYN}/battle-map`)).toMatch(
      /no "scenes" tab/,
    );
  });

  it('redirects /app/campaigns to the campaign list at /app', () => {
    const leaf = matchRoutes(getAppRoutes(), '/campaigns')?.at(-1);
    const element = leaf?.route.element as React.ReactElement<{ to: string }>;
    expect(element.props.to).toBe('/app');
  });
});

describe('/app catch-all', () => {
  const AppRouteTable = (): React.ReactElement | null => useRoutes(getAppRoutes());
  const LocationProbe = (): React.ReactElement => (
    <div data-testid="location">{useLocation().pathname}</div>
  );

  const renderAt = (path: string): ReturnType<typeof render> =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app" element={<p>campaign list</p>} />
          <Route path="/app/*" element={<AppRouteTable />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );

  it('renders "Page not found" for an unknown /app path', () => {
    renderAt('/app/definitely-not-a-page');
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('heading').nextElementSibling).toHaveTextContent(
      'Nothing lives at /app/definitely-not-a-page.',
    );
  });

  it('links back to the campaign list', () => {
    renderAt('/app/home');
    fireEvent.click(screen.getByRole('link', { name: 'Back to your campaigns' }));
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/app$/);
    expect(screen.getByText('campaign list')).toBeInTheDocument();
  });
});
