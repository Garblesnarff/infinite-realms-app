/* eslint-disable max-lines */
import React, { lazy, Suspense } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';

import { AuthProvider } from './contexts/AuthContext';
import { CampaignProvider } from './contexts/CampaignContext';
import { CharacterProvider } from './contexts/CharacterContext';
import { useTelemetry } from './hooks/use-telemetry';
import { TRPCProvider } from './lib/trpc/Provider';
import { ErrorBoundary } from './shared/components/error/ErrorBoundary';
import Breadcrumbs from './shared/components/layout/breadcrumbs';
import Navigation from './shared/components/layout/navigation';
import { RouteLoading } from './shared/components/RouteLoading';

import { Z_INDEX } from '@/constants/z-index';
import { ProtectedRoute } from '@/features/auth';

// Lazy load route page components for code splitting
const Index = lazy(() => import('./pages/Index'));
const Landing = lazy(() => import('./pages/Landing'));
const LaunchPage = lazy(() => import('./pages/LaunchPage'));
const CallbackPage = lazy(() => import('./features/auth/components/CallbackPage'));
const DiceTest = lazy(() => import('./pages/DiceTest'));
const CharacterSheet = lazy(() => import('./features/character/components/sheet/character-sheet'));
const CharacterList = lazy(() => import('./features/character/components/list/character-list'));
const CampaignWizard = lazy(
  () => import('./features/campaign/components/creation/campaign-wizard'),
);
const GameContentWithErrorBoundary = lazy(
  () => import('./features/game-session/components/game/GameContentWithErrorBoundary'),
);
const CharacterCreateEntry = lazy(() => import('./pages/CharacterCreateEntry'));
const CampaignHubWithErrorBoundary = lazy(
  () => import('./pages/campaigns/CampaignHubWithErrorBoundary'),
);
const SceneManagementPage = lazy(() => import('./pages/SceneManagementPage'));
const BattleMapPage = lazy(() => import('./pages/BattleMapPage'));
const BlogAdminLogin = lazy(() => import('./pages/BlogAdminLogin'));
const BlogAdmin = lazy(() => import('./pages/BlogAdmin'));
const BlogEditor = lazy(() => import('./pages/BlogEditor'));
const AccountPage = lazy(() => import('./pages/AccountPage'));
const CampaignDetailPage = lazy(() => import('./pages/CampaignDetailPage'));
const ExploreGalleryPage = lazy(() => import('./pages/ExploreGalleryPage'));
const StarterCharacterSelectionPage = lazy(() => import('./pages/StarterCharacterSelectionPage'));

// TODO [legacy-character-deprecation]: Feature flag for legacy character entry. When disabling legacy character creation, set to false and then remove this flag following docs/cleanup/campaign-character-migration.md
const ENABLE_LEGACY_CHARACTER_ENTRY = true;

/**
 * Main App component
 * Provides routing and global providers for the application
 */
function App() {
  // Enable global telemetry tracking with crash detection
  useTelemetry({
    enableCrashDetection: true,
  });

  return (
    <ErrorBoundary level="app">
      <HelmetProvider>
        <AuthProvider>
          <TRPCProvider>
            <CharacterProvider>
              <CampaignProvider>
                <Router
                  future={{
                    v7_startTransition: true,
                    v7_relativeSplatPath: true,
                  }}
                >
                  <div className="min-h-screen">
                    {/* Skip to content for keyboard users */}
                    <a
                      href="#main-content"
                      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:bg-primary focus:text-primary-foreground focus:px-3 focus:py-2 focus:rounded"
                      style={{ zIndex: Z_INDEX.LOADING_OVERLAY }}
                    >
                      Skip to content
                    </a>
                    <Routes>
                      {/* Beta Launch Page - new main entry point */}
                      <Route
                        path="/"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <LaunchPage />
                          </Suspense>
                        }
                      />

                      {/* Original landing page - keep as backup */}
                      <Route
                        path="/original-landing"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <Landing />
                          </Suspense>
                        }
                      />

                      {/* OAuth callback route for WorkOS */}
                      <Route
                        path="/auth/callback"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <CallbackPage />
                          </Suspense>
                        }
                      />

                      {/* Explore Gallery - browse all starter campaigns */}
                      <Route
                        path="/explore"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <ExploreGalleryPage />
                          </Suspense>
                        }
                      />

                      {/* Campaign Detail Page - public browse/explore route */}
                      <Route
                        path="/explore/:slug"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <CampaignDetailPage />
                          </Suspense>
                        }
                      />

                      {/* Starter Character Selection - choose pre-built or custom character */}
                      <Route
                        path="/explore/:slug/choose-character"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <StarterCharacterSelectionPage />
                          </Suspense>
                        }
                      />

                      {/* Blog Admin Login (public - separate from WorkOS auth) */}
                      <Route
                        path="/admin/blog/login"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <BlogAdminLogin />
                          </Suspense>
                        }
                      />

                      {/* Blog Admin Panel (separate auth from WorkOS) */}
                      <Route
                        path="/admin/blog"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <BlogAdmin />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/admin/blog/edit/:id"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <BlogEditor />
                          </Suspense>
                        }
                      />
                      <Route
                        path="/admin/blog/new"
                        element={
                          <Suspense fallback={<RouteLoading />}>
                            <BlogEditor />
                          </Suspense>
                        }
                      />

                      {/* Protected app routes */}
                      <Route
                        path="/app/*"
                        element={
                          <ProtectedRoute>
                            <Navigation />
                            <Breadcrumbs />
                            <main id="main-content" tabIndex={-1}>
                              <Routes>
                                <Route
                                  path="/"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <Index />
                                    </Suspense>
                                  }
                                />
                                <Route
                                  path="/dice-test"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <DiceTest />
                                    </Suspense>
                                  }
                                />
                                {/* TODO [legacy-character-deprecation]: Legacy character list and creation routes. Gate behind ENABLE_LEGACY_CHARACTER_ENTRY and remove per docs/cleanup/campaign-character-migration.md */}
                                {ENABLE_LEGACY_CHARACTER_ENTRY && (
                                  <Route
                                    path="/characters"
                                    element={
                                      <Suspense fallback={<RouteLoading />}>
                                        <CharacterList />
                                      </Suspense>
                                    }
                                  />
                                )}
                                {ENABLE_LEGACY_CHARACTER_ENTRY && (
                                  <Route
                                    path="/characters/create"
                                    element={
                                      <Suspense fallback={<RouteLoading />}>
                                        <CharacterCreateEntry />
                                      </Suspense>
                                    }
                                  />
                                )}
                                {ENABLE_LEGACY_CHARACTER_ENTRY && (
                                  <Route
                                    path="/characters/new"
                                    element={
                                      <Suspense fallback={<RouteLoading />}>
                                        <CharacterCreateEntry />
                                      </Suspense>
                                    }
                                  />
                                )}
                                <Route
                                  path="/character/:id"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <CharacterSheet />
                                    </Suspense>
                                  }
                                />
                                <Route
                                  path="/campaigns/create"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <CampaignWizard />
                                    </Suspense>
                                  }
                                />
                                <Route
                                  path="/campaigns/:campaignId/scenes/:sceneId"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <BattleMapPage />
                                    </Suspense>
                                  }
                                />
                                <Route
                                  path="/campaigns/:campaignId/scenes"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <SceneManagementPage />
                                    </Suspense>
                                  }
                                />
                                <Route
                                  path="/campaigns/:id/*"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <CampaignHubWithErrorBoundary />
                                    </Suspense>
                                  }
                                />
                                <Route
                                  path="/game/:id"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <GameContentWithErrorBoundary />
                                    </Suspense>
                                  }
                                />
                                {/* Blog Admin Panel */}
                                <Route
                                  path="/blog"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <BlogAdmin />
                                    </Suspense>
                                  }
                                />
                                <Route
                                  path="/blog/edit/:id"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <BlogEditor />
                                    </Suspense>
                                  }
                                />
                                <Route
                                  path="/blog/new"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <BlogEditor />
                                    </Suspense>
                                  }
                                />
                                {/* Account/Subscription Management */}
                                <Route
                                  path="/account"
                                  element={
                                    <Suspense fallback={<RouteLoading />}>
                                      <AccountPage />
                                    </Suspense>
                                  }
                                />
                              </Routes>
                            </main>
                          </ProtectedRoute>
                        }
                      />
                    </Routes>
                    <Toaster />
                  </div>
                </Router>
              </CampaignProvider>
            </CharacterProvider>
          </TRPCProvider>
        </AuthProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;
