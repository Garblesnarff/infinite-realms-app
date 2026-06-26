import {
  Calendar,
  Lightbulb,
  Sparkles,
  Star,
} from 'lucide-react';
import React from 'react';

import type { InspirationEntry } from '@/features/character/hooks/use-personality-manager';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface InspirationSectionProps {
  hasInspiration: boolean;
  toggleInspiration: () => void;
  inspirationNotes: string;
  setInspirationNotes: (value: string) => void;
  awardInspiration: (trigger: string, source: InspirationEntry['source'], description: string) => void;
  inspirationHistory: InspirationEntry[];
  awardInspirationId: string;
}

/**
 * InspirationSection component for managing character inspiration
 */
export const InspirationSection: React.FC<InspirationSectionProps> = ({
  hasInspiration,
  toggleInspiration,
  inspirationNotes,
  setInspirationNotes,
  awardInspiration,
  inspirationHistory,
  awardInspirationId,
}) => {
  return (
    <Card className={`${hasInspiration ? 'border-gold-500 bg-gold-50 dark:bg-gold-950/20' : ''}`}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Lightbulb
              className={`w-5 h-5 ${hasInspiration ? 'text-gold-500' : 'text-gray-500'}`}
            />
            Inspiration
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center">
                <Switch
                  checked={hasInspiration}
                  onCheckedChange={toggleInspiration}
                  aria-label="Toggle inspiration"
                />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Toggle character inspiration</p>
            </TooltipContent>
          </Tooltip>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div
              className={`w-16 h-16 rounded-full border-4 flex items-center justify-center ${
                hasInspiration
                  ? 'border-gold-500 bg-gold-100 dark:bg-gold-900/50'
                  : 'border-gray-300 bg-gray-100 dark:bg-gray-800'
              }`}
            >
              <Star
                className={`w-8 h-8 ${hasInspiration ? 'text-gold-500 animate-pulse' : 'text-gray-400'}`}
              />
            </div>
            <div className="flex-1">
              <h3 className="font-medium">
                {hasInspiration ? 'You have inspiration!' : 'No inspiration'}
              </h3>
              <p className="text-sm text-muted-foreground">
                {hasInspiration
                  ? 'You can use inspiration to gain advantage on one ability check, attack roll, or saving throw.'
                  : 'Inspiration is awarded for excellent roleplaying, particularly when acting on your personality traits, ideals, bonds, and flaws.'}
              </p>
            </div>
          </div>

          {/* Award Inspiration */}
          <div className="space-y-3 border-t pt-4">
            <Label htmlFor={awardInspirationId}>Award Inspiration</Label>
            <div className="flex gap-2">
              <Textarea
                id={awardInspirationId}
                placeholder="Reason for inspiration (e.g., 'Acted on bond to protect family')"
                value={inspirationNotes}
                onChange={(e) => setInspirationNotes(e.target.value)}
                className="flex-1"
                rows={2}
              />
              <div className="flex flex-col gap-1">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => awardInspiration(inspirationNotes, 'dm', inspirationNotes)}
                      disabled={!inspirationNotes.trim() || hasInspiration}
                    >
                      <Sparkles className="w-4 h-4 mr-1" />
                      Award
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Award inspiration to character</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Inspiration History */}
          {inspirationHistory.length > 0 && (
            <div className="space-y-2 border-t pt-4">
              <Label className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Inspiration History
              </Label>
              <div className="max-h-32 overflow-y-auto space-y-2">
                {inspirationHistory
                  .slice(-5)
                  .reverse()
                  .map((entry, index) => (
                    <div key={index} className="text-xs p-2 bg-muted/50 rounded">
                      <div className="flex justify-between items-center">
                        <Badge variant="outline" className="text-xs">
                          {entry.source.toUpperCase()}
                        </Badge>
                        <span className="text-muted-foreground">
                          {new Date(entry.date).toLocaleDateString()}
                        </span>
                      </div>
                      <p className="mt-1">{entry.description}</p>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
