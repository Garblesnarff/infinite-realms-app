import { Calendar } from 'lucide-react';
import React from 'react';

import type { ExperienceEntry } from './useExperienceManager';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';


interface ExperienceHistoryProps {
  showHistory: boolean;
  setShowHistory: (show: boolean) => void;
  experienceHistory: ExperienceEntry[];
  historyId: string;
  historyTitleId: string;
}

export const ExperienceHistory: React.FC<ExperienceHistoryProps> = ({
  showHistory,
  setShowHistory,
  experienceHistory,
  historyId,
  historyTitleId,
}) => {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle id={historyTitleId} className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-indigo-500" aria-hidden="true" />
            Experience History
          </CardTitle>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowHistory(!showHistory)}
                aria-expanded={showHistory}
                aria-controls={historyId}
                aria-label={showHistory ? 'Hide history' : 'Show history'}
              >
                {showHistory ? 'Hide' : 'Show'} History
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{showHistory ? 'Hide history' : 'Show history'}</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      {showHistory && (
        <CardContent id={historyId} role="region" aria-labelledby={historyTitleId}>
          <div className="space-y-3">
            {experienceHistory.length > 0 ? (
              experienceHistory.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 border rounded-lg"
                >
                  <div className="flex-1">
                    <div className="font-medium">{entry.source}</div>
                    <div className="text-sm text-muted-foreground">{entry.date}</div>
                  </div>
                  <Badge variant={entry.type === 'gain' ? 'default' : 'destructive'}>
                    {entry.type === 'gain' ? '+' : '-'}
                    {entry.amount} XP
                  </Badge>
                </div>
              ))
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                No experience history available
              </div>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  );
};
