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
        {/* #355: declare the full tag set — react-helmet-async deletes managed
            (data-rh) tags a page does not redeclare. */}
        <title>Page not found | InfiniteRealms</title>
        <meta
          name="description"
          content="Create persistent worlds that evolve across generations. Build campaigns, characters, and stories that live forever in your own personal universe."
        />
        <meta property="og:title" content="Page not found | InfiniteRealms" />
        <meta
          property="og:description"
          content="Create persistent worlds that evolve across generations. Build campaigns, characters, and stories that live forever in your own personal universe."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://infiniterealms.app/" />
        <meta property="og:image" content="https://infiniterealms.app/og-image.png" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Page not found | InfiniteRealms" />
        <meta
          name="twitter:description"
          content="Create persistent worlds that evolve across generations. Build campaigns, characters, and stories that live forever in your own personal universe."
        />
        <meta name="twitter:image" content="https://infiniterealms.app/og-image.png" />
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
