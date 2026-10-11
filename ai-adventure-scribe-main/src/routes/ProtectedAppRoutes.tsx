import React from 'react';
import { Helmet } from 'react-helmet-async';
import { useRoutes } from 'react-router-dom';

import { getAppRoutes } from './app-routes';

import { ProtectedRoute } from '@/features/auth';
import Breadcrumbs from '@/shared/components/layout/breadcrumbs';
import Navigation from '@/shared/components/layout/navigation';

const AppRouteTable: React.FC = () => useRoutes(getAppRoutes());

/**
 * The authenticated /app/* subtree: app chrome (navigation, breadcrumbs)
 * plus the nested route table, all behind ProtectedRoute.
 */
export const ProtectedAppRoutes: React.FC = () => (
  <ProtectedRoute>
    <div className="ir-app max-w-full overflow-x-hidden">
      {/*
        #355: fallback meta set for the authenticated app. No /app/* route renders
        its own Helmet, and react-helmet-async deletes every managed (data-rh)
        tag when the last Helmet unmounts — without this, navigating from a public
        page into the app would wipe the static description / og tags for the rest
        of the session. Values mirror the index.html fallbacks.
      */}
      <Helmet>
        <title>InfiniteRealms - Your World, Your Story, Forever</title>
        <meta
          name="description"
          content="Create persistent worlds that evolve across generations. Build campaigns, characters, and stories that live forever in your own personal universe."
        />
        <meta property="og:title" content="Infinite Realms — Your World, Your Story, Forever" />
        <meta
          property="og:description"
          content="Create persistent worlds that evolve across generations. Build campaigns, characters, and stories that live forever in your own personal universe."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://infiniterealms.app/" />
        <meta property="og:image" content="https://infiniterealms.app/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Infinite Realms — Your World, Your Story, Forever" />
        <meta
          name="twitter:description"
          content="Create persistent worlds that evolve across generations. Build campaigns, characters, and stories that live forever in your own personal universe."
        />
        <meta name="twitter:image" content="https://infiniterealms.app/og-image.png" />
      </Helmet>
      <Navigation />
      <Breadcrumbs />
      <main id="main-content" tabIndex={-1}>
        <AppRouteTable />
      </main>
    </div>
  </ProtectedRoute>
);
