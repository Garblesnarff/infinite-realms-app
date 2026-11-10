import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

/**
 * The Legend gate for custom hero creation (#1239). Shown on a free plan by the wizard
 * entry, and when the server refuses a custom or imported hero with LEGEND_REQUIRED (#1344).
 */
export const LegendGateCard: React.FC<{ backTarget: string; backLabel: string }> = ({
  backTarget,
  backLabel,
}) => {
  const navigate = useNavigate();
  return (
    <div className="container mx-auto px-4 py-8">
      <Card className="p-6">
        <h1 className="text-2xl font-semibold mb-2">Creating your own hero is a Legend feature</h1>
        <p className="text-muted-foreground mb-4">
          Legend lets you create custom heroes and keep them across adventures. Premade heroes are
          free — pick one to start playing right away.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={() => navigate('/app/account')}>Upgrade to Legend</Button>
          <Button variant="outline" onClick={() => navigate('/explore')}>
            Browse premade heroes
          </Button>
          <Button variant="outline" onClick={() => navigate(backTarget)}>
            {backLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
};
