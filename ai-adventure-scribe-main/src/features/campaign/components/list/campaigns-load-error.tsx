import { Button } from '@/components/ui/button';

interface CampaignsLoadErrorProps {
  onRetry: () => void;
  isRetrying?: boolean;
}

/**
 * Shown when the campaigns list request fails (including 429), so a failed
 * load never renders as an empty roster (#2149).
 */
const CampaignsLoadError = ({
  onRetry,
  isRetrying = false,
}: CampaignsLoadErrorProps): JSX.Element => (
  <div role="alert" className="text-center space-y-4 py-12">
    <p className="text-destructive">Couldn&apos;t load — retry</p>
    <Button variant="outline" onClick={onRetry} disabled={isRetrying}>
      {isRetrying ? 'Retrying…' : 'Retry'}
    </Button>
  </div>
);

export default CampaignsLoadError;
