import { lazy } from 'react';

export const LEGAL_ROUTES = [
  { path: '/privacy', Component: lazy(() => import('./PrivacyPage')) },
  { path: '/terms', Component: lazy(() => import('./TermsPage')) },
  { path: '/cookies', Component: lazy(() => import('./CookiesPage')) },
  { path: '/contact', Component: lazy(() => import('./ContactPage')) },
];
