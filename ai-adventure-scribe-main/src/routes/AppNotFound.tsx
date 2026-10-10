import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { IRPanel } from '@/components/ui/ir-primitives';

/**
 * Catch-all for an unknown URL. Public pages link home (`/`); /app links back
 * to the campaign list. One page, so a broken link is never a blank screen
 * (#2155, #2706). Emits noindex: unknown URLs are served with HTTP 200 by the
 * SPA fallback, so crawlers must not index them (#227 AU-04).
 */
const AppNotFound: React.FC<{ homeTo?: string; homeLabel?: string }> = ({
  homeTo = '/app',
  homeLabel = 'Back to your campaigns',
}) => {
  const location = useLocation();

  return (
    <div className="container mx-auto px-4 py-16">
      <Helmet>
        <meta name="robots" content="noindex, nofollow" />
      </Helmet>
      <IRPanel className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-2xl font-semibold text-infinite-gold mb-2">Page not found</h1>
        <p className="text-muted-foreground mb-6">
          Nothing lives at <code className="break-all">{location.pathname}</code>.
        </p>
        <Button asChild variant="ir-gold">
          <Link to={homeTo}>{homeLabel}</Link>
        </Button>
      </IRPanel>
    </div>
  );
};

export default AppNotFound;
