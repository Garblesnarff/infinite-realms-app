import { ArrowLeft } from 'lucide-react';
import React from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface BattleMapErrorProps {
  message?: string;
  onBackToScenes: () => void;
  onBackToCampaign: () => void;
}

/**
 * Battle Map Error Component
 *
 * Extracted from BattleMapPage to handle permission and missing scene errors.
 */
export const BattleMapError: React.FC<BattleMapErrorProps> = ({
  message,
  onBackToScenes,
  onBackToCampaign,
}) => {
  const errorMessage = message || 'Scene not found';
  const isPermissionError =
    errorMessage.toLowerCase().includes('permission') ||
    errorMessage.toLowerCase().includes('forbidden') ||
    errorMessage.toLowerCase().includes('access');

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="max-w-lg w-full">
        <CardHeader>
          <CardTitle className="text-destructive">
            {isPermissionError ? 'Access Denied' : 'Scene Not Found'}
          </CardTitle>
          <CardDescription>
            {isPermissionError
              ? "You don't have permission to view this scene."
              : 'The scene you are looking for does not exist or has been deleted.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{errorMessage}</p>
          <div className="flex gap-2">
            <Button onClick={onBackToScenes} variant="outline" className="flex-1">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Scenes
            </Button>
            <Button onClick={onBackToCampaign} className="flex-1">
              Back to Campaign
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
