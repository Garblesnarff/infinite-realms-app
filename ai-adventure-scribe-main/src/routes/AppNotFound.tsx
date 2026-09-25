import React from 'react';
import { Link, useLocation } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { IRPanel } from '@/components/ui/ir-primitives';

/**
 * Catch-all for unknown /app/* paths. Renders a visible dead-end with a way
 * back instead of an empty <main>, so a broken link is noticed (#2155).
 */
const AppNotFound: React.FC = () => {
  const location = useLocation();

  return (
    <div className="container mx-auto px-4 py-16">
      <IRPanel className="mx-auto max-w-lg p-8 text-center">
        <h1 className="text-2xl font-semibold text-infinite-gold mb-2">Page not found</h1>
        <p className="text-muted-foreground mb-6">
          Nothing lives at <code className="break-all">{location.pathname}</code>.
        </p>
        <Button asChild variant="ir-gold">
          <Link to="/app">Back to your campaigns</Link>
        </Button>
      </IRPanel>
    </div>
  );
};

export default AppNotFound;
