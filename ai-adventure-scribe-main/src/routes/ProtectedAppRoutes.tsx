import React from 'react';
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
    <div className="ir-app">
      <Navigation />
      <Breadcrumbs />
      <main id="main-content" tabIndex={-1}>
        <AppRouteTable />
      </main>
    </div>
  </ProtectedRoute>
);
