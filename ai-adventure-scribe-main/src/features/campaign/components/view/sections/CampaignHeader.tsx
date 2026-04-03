import { Trash2 } from 'lucide-react';
import React from 'react';

import type { Campaign } from '@/types/game';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface CampaignHeaderProps {
  campaign: Campaign;
  isDeleting: boolean;
  onDelete: () => void;
}

/**
 * CampaignHeader component displays the campaign title and delete button
 */
export const CampaignHeader: React.FC<CampaignHeaderProps> = ({
  campaign,
  isDeleting,
  onDelete,
}) => {
  return (
    <div className="flex justify-between items-start mb-8">
      <h1 className="text-3xl font-bold">{campaign.name}</h1>

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button
            variant="destructive"
            size="icon"
            disabled={isDeleting}
            aria-label="Delete campaign"
            title="Delete campaign"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the campaign "{campaign.name}" and all of its associated
              game sessions. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? 'Deleting...' : 'Delete Campaign'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
