import { lazy } from 'react';
import { HelmetProvider } from 'react-helmet-async';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'sonner';

import { AuthProvider } from './contexts/AuthContext';
import { CampaignProvider } from './contexts/CampaignContext';
import { CharacterProvider } from './contexts/CharacterContext';
import { useTelemetry } from './hooks/use-telemetry';
import { TRPCProvider } from './lib/trpc/Provider';
import { ProtectedAppRoutes } from './routes/ProtectedAppRoutes';
import { withRouteSuspense } from './routes/route-suspense';
import { ErrorBoundary } from './shared/components/error/ErrorBoundary';

import { TooltipProvider } from '@/components/ui/tooltip';
import { Z_INDEX } from '@/constants/z-index';

// Lazy load route page components for code splitting
const Landing = lazy(() => import('./pages/Landing'));
const LaunchPage = lazy(() => import('./pages/LaunchPage'));
const CallbackPage = lazy(() => import('./features/auth/components/CallbackPage'));
const GameUIPreview = lazy(() => import('./pages/GameUIPreview'));
const BlogAdminLogin = lazy(() => import('./pages/BlogAdminLogin'));
const BlogAdmin = lazy(() => import('./pages/BlogAdmin'));
const BlogEditor = lazy(() => import('./pages/BlogEditor'));
const CampaignDetailPage = lazy(() => import('./pages/CampaignDetailPage'));
const ExploreGalleryPage = lazy(() => import('./pages/ExploreGalleryPage'));
const StarterCharacterSelectionPage = lazy(() => import('./pages/StarterCharacterSelectionPage'));

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
                <TooltipProvider delayDuration={300}>
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
                        {/* Public preview of the navy+gold game UI overhaul (mock data) */}
                        <Route path="/ui-preview" element={withRouteSuspense(<GameUIPreview />)} />

                        {/* Beta Launch Page - new main entry point */}
                        <Route path="/" element={withRouteSuspense(<LaunchPage />)} />

                        {/* Original landing page - keep as backup */}
                        <Route path="/original-landing" element={withRouteSuspense(<Landing />)} />

                        {/* OAuth callback route for WorkOS */}
                        <Route
                          path="/auth/callback"
                          element={withRouteSuspense(<CallbackPage />)}
                        />

                        {/* Explore Gallery - browse all starter campaigns */}
                        <Route
                          path="/explore"
                          element={withRouteSuspense(<ExploreGalleryPage />)}
                        />

                        {/* Campaign Detail Page - public browse/explore route */}
                        <Route
                          path="/explore/:slug"
                          element={withRouteSuspense(<CampaignDetailPage />)}
                        />

                        {/* Starter Character Selection - choose pre-built or custom character */}
                        <Route
                          path="/explore/:slug/choose-character"
                          element={withRouteSuspense(<StarterCharacterSelectionPage />)}
                        />

                        {/* Blog Admin Login (public - separate from WorkOS auth) */}
                        <Route
                          path="/admin/blog/login"
                          element={withRouteSuspense(<BlogAdminLogin />)}
                        />

                        {/* Blog Admin Panel (separate auth from WorkOS) */}
                        <Route path="/admin/blog" element={withRouteSuspense(<BlogAdmin />)} />
                        <Route
                          path="/admin/blog/edit/:id"
                          element={withRouteSuspense(<BlogEditor />)}
                        />
                        <Route path="/admin/blog/new" element={withRouteSuspense(<BlogEditor />)} />

                        {/* Protected app routes */}
                        <Route path="/app/*" element={<ProtectedAppRoutes />} />
                      </Routes>
                      <Toaster />
                    </div>
                  </Router>
                </TooltipProvider>
              </CampaignProvider>
            </CharacterProvider>
          </TRPCProvider>
        </AuthProvider>
      </HelmetProvider>
    </ErrorBoundary>
  );
}

export default App;
