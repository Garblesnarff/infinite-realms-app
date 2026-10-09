import { lazy } from 'react';
import { Navigate, useLocation, useParams, type RouteObject } from 'react-router-dom';

import AppNotFound from './AppNotFound';
import { withRouteSuspense } from './route-suspense';

import { isCustomCampaignsEnabled } from '@/config/featureFlags';
import { CAMPAIGN_HUB_TABS } from '@/pages/campaigns/CampaignHubTabsList';

// Lazy load route page components for code splitting
const Index = lazy(() => import('@/pages/Index'));
const CharacterSheet = lazy(() => import('@/features/character/components/sheet/character-sheet'));
const CharacterList = lazy(() => import('@/features/character/components/list/character-list'));
const CampaignWizard = lazy(
  () => import('@/features/campaign/components/creation/campaign-wizard'),
);
const GameContentWithErrorBoundary = lazy(
  () => import('@/features/game-session/components/game/GameContentWithErrorBoundary'),
);
const CharacterCreateEntry = lazy(() => import('@/pages/CharacterCreateEntry'));
const CampaignHubWithErrorBoundary = lazy(
  () => import('@/pages/campaigns/CampaignHubWithErrorBoundary'),
);
const BlogAdmin = lazy(() => import('@/pages/BlogAdmin'));
const BlogEditor = lazy(() => import('@/pages/BlogEditor'));
const AccountPage = lazy(() => import('@/pages/AccountPage'));

// TODO [legacy-character-deprecation]: Feature flag for legacy character entry. When disabling legacy character creation, set to false and then remove this flag following docs/cleanup/campaign-character-migration.md
const ENABLE_LEGACY_CHARACTER_ENTRY = true;

function CampaignHubRoute() {
  const { id, '*': splat } = useParams();
  const location = useLocation();
  const tab = (splat ?? '').split('/').filter(Boolean)[0] ?? '';
  if (tab === 'scenes') return <AppNotFound />;
  if (tab && !CAMPAIGN_HUB_TABS.has(tab)) {
    return <Navigate to={{ pathname: `/app/campaigns/${id}`, search: location.search }} replace />;
  }
  return withRouteSuspense(<CampaignHubWithErrorBoundary />);
}

/**
 * The /app/* route table, relative to the /app mount in App.tsx. Exported so
 * tests can check that every in-app link target resolves to a real route.
 * A function, not a constant, so feature flags are read at render time.
 */
export const getAppRoutes = (): RouteObject[] => [
  { path: '/', element: withRouteSuspense(<Index />) },
  // TODO [legacy-character-deprecation]: Legacy character list and creation routes. Gated behind ENABLE_LEGACY_CHARACTER_ENTRY; remove per docs/cleanup/campaign-character-migration.md
  ...(ENABLE_LEGACY_CHARACTER_ENTRY
    ? [
        { path: '/characters', element: withRouteSuspense(<CharacterList />) },
        { path: '/characters/create', element: withRouteSuspense(<CharacterCreateEntry />) },
        { path: '/characters/new', element: withRouteSuspense(<CharacterCreateEntry />) },
      ]
    : []),
  { path: '/character/:id', element: withRouteSuspense(<CharacterSheet />) },
  // The campaign list is the /app index; there is no separate list page.
  { path: '/campaigns', element: <Navigate to="/app" replace /> },
  /*
    Custom campaign wizard (#2192): off for beta users. The wizard saves a
    campaign row but no playable content, so the route redirects to the
    campaign list (Index) while the flag is off. Existing campaigns are
    untouched — only the wizard entry points are gated.
  */
  isCustomCampaignsEnabled()
    ? { path: '/campaigns/create', element: withRouteSuspense(<CampaignWizard />) }
    : { path: '/campaigns/create', element: <Navigate to="/app/" replace /> },
  // /campaigns/new is not the wizard. It used to match :id and show "Campaign not found" (#2706).
  { path: '/campaigns/new', element: <Navigate to="/app" replace /> },
  { path: '/campaigns/:id/*', element: <CampaignHubRoute /> },
  { path: '/game/:id', element: withRouteSuspense(<GameContentWithErrorBoundary />) },
  // Blog Admin Panel
  { path: '/blog', element: withRouteSuspense(<BlogAdmin />) },
  { path: '/blog/edit/:id', element: withRouteSuspense(<BlogEditor />) },
  { path: '/blog/new', element: withRouteSuspense(<BlogEditor />) },
  // Account/Subscription Management
  { path: '/account', element: withRouteSuspense(<AccountPage />) },
  // Anything else under /app renders a visible not-found page, never a blank <main>.
  { path: '*', element: <AppNotFound /> },
];
