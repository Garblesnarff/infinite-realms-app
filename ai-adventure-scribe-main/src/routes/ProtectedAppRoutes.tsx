import React, { lazy } from 'react';
import { Routes, Route } from 'react-router-dom';

import { withRouteSuspense } from './route-suspense';

import { ProtectedRoute } from '@/features/auth';
import Breadcrumbs from '@/shared/components/layout/breadcrumbs';
import Navigation from '@/shared/components/layout/navigation';

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
const SceneManagementPage = lazy(() => import('@/pages/SceneManagementPage'));
const BattleMapPage = lazy(() => import('@/pages/BattleMapPage'));
const BlogAdmin = lazy(() => import('@/pages/BlogAdmin'));
const BlogEditor = lazy(() => import('@/pages/BlogEditor'));
const AccountPage = lazy(() => import('@/pages/AccountPage'));

// TODO [legacy-character-deprecation]: Feature flag for legacy character entry. When disabling legacy character creation, set to false and then remove this flag following docs/cleanup/campaign-character-migration.md
const ENABLE_LEGACY_CHARACTER_ENTRY = true;

/**
 * The authenticated /app/* subtree: app chrome (navigation, breadcrumbs)
 * plus the nested route table, all behind ProtectedRoute.
 */
export const ProtectedAppRoutes: React.FC = () => (
  <ProtectedRoute>
    <div className="ir-app">
      <Navigation />
      <Breadcrumbs />
      <main id="main-content" tabIndex={-1}>
        <Routes>
          <Route path="/" element={withRouteSuspense(<Index />)} />
          {/* TODO [legacy-character-deprecation]: Legacy character list and creation routes. Gate behind ENABLE_LEGACY_CHARACTER_ENTRY and remove per docs/cleanup/campaign-character-migration.md */}
          {ENABLE_LEGACY_CHARACTER_ENTRY && (
            <Route path="/characters" element={withRouteSuspense(<CharacterList />)} />
          )}
          {ENABLE_LEGACY_CHARACTER_ENTRY && (
            <Route
              path="/characters/create"
              element={withRouteSuspense(<CharacterCreateEntry />)}
            />
          )}
          {ENABLE_LEGACY_CHARACTER_ENTRY && (
            <Route path="/characters/new" element={withRouteSuspense(<CharacterCreateEntry />)} />
          )}
          <Route path="/character/:id" element={withRouteSuspense(<CharacterSheet />)} />
          <Route path="/campaigns/create" element={withRouteSuspense(<CampaignWizard />)} />
          <Route
            path="/campaigns/:campaignId/scenes/:sceneId"
            element={withRouteSuspense(<BattleMapPage />)}
          />
          <Route
            path="/campaigns/:campaignId/scenes"
            element={withRouteSuspense(<SceneManagementPage />)}
          />
          <Route
            path="/campaigns/:id/*"
            element={withRouteSuspense(<CampaignHubWithErrorBoundary />)}
          />
          <Route path="/game/:id" element={withRouteSuspense(<GameContentWithErrorBoundary />)} />
          {/* Blog Admin Panel */}
          <Route path="/blog" element={withRouteSuspense(<BlogAdmin />)} />
          <Route path="/blog/edit/:id" element={withRouteSuspense(<BlogEditor />)} />
          <Route path="/blog/new" element={withRouteSuspense(<BlogEditor />)} />
          {/* Account/Subscription Management */}
          <Route path="/account" element={withRouteSuspense(<AccountPage />)} />
        </Routes>
      </main>
    </div>
  </ProtectedRoute>
);
