import { Calendar, Lightbulb, Star } from 'lucide-react';
import React from 'react';

import type { InspirationEntry } from '@/features/character/hooks/use-personality-manager';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';

interface InspirationSectionProps {
  hasInspiration: boolean;
  inspirationHistory: InspirationEntry[];
}

/**
 * InspirationSection component for displaying character inspiration (read-only on sheet)
 */
export const InspirationSection: React.FC<InspirationSectionProps> = ({
  hasInspiration,
  inspirationHistory,
}) => {
  const label = hasInspiration ? 'held' : 'not held';

  return (
    <Card className={`${hasInspiration ? 'border-infinite-gold bg-infinite-gold/10' : ''}`}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb
            className={`w-5 h-5 ${hasInspiration ? 'text-infinite-gold' : 'text-muted-foreground'}`}
          />
          Inspiration
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <div
              className={`w-16 h-16 rounded-full border-4 flex items-center justify-center ${
                hasInspiration
                  ? 'border-infinite-gold bg-infinite-gold/15'
                  : 'border-border bg-muted'
              }`}
              aria-label={label}
            >
              <Star
                className={`w-8 h-8 ${hasInspiration ? 'text-infinite-gold animate-pulse' : 'text-muted-foreground'}`}
              />
            </div>
            <div className="flex-1">
              <h3 className="font-medium">{label}</h3>
              <p className="text-sm text-muted-foreground">
                {hasInspiration
                  ? 'You can use inspiration to gain advantage on one ability check, attack roll, or saving throw.'
                  : 'Inspiration is awarded for excellent roleplaying, particularly when acting on your personality traits, ideals, bonds, and flaws.'}
              </p>
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
