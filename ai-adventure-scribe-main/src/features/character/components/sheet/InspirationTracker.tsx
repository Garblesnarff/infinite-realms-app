import { Lightbulb, Star, Sparkles } from 'lucide-react';
import React from 'react';

import type { Character } from '@/types/character';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useToast } from '@/hooks/use-toast';

interface InspirationTrackerProps {
  character: Character;
  onUpdate: (updatedCharacter: Character) => void;
}

/**
 * Compact inspiration tracker for main character sheet
 */
const InspirationTracker: React.FC<InspirationTrackerProps> = ({ character, onUpdate }) => {
  const { toast } = useToast();
  const hasInspiration = character?.inspiration || false;

  /**
   * Toggle inspiration state
   */
  const toggleInspiration = () => {
    const newInspirationState = !hasInspiration;

    onUpdate({
      ...character,
      inspiration: newInspirationState,
      personalityIntegration: {
        ...character?.personalityIntegration,
        activeTraits: character?.personalityIntegration?.activeTraits || [],
        inspirationTriggers: character?.personalityIntegration?.inspirationTriggers || [],
        lastInspiration: newInspirationState
          ? new Date().toISOString()
          : character?.personalityIntegration?.lastInspiration,
        inspirationHistory: character?.personalityIntegration?.inspirationHistory || [],
      },
    });

    toast({
      title: newInspirationState ? 'Inspiration Gained!' : 'Inspiration Used',
      description: newInspirationState
        ? 'You now have inspiration. Use it to gain advantage on a roll!'
        : 'Inspiration used. Act on your personality to earn more!',
    });
  };

  return (
    <Card className={`${hasInspiration ? 'border-infinite-gold bg-infinite-gold/10' : ''}`}>
      <CardContent className="p-4">
        {/* Screen reader announcement for inspiration state */}
        <div className="sr-only" role="status" aria-live="polite">
          {hasInspiration ? 'Character has inspiration' : 'Character has no inspiration'}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={`w-12 h-12 rounded-full border-2 flex items-center justify-center ${
                hasInspiration ? 'border-infinite-gold bg-infinite-gold/15' : 'border-border bg-muted'
              }`}
            >
              <Star
                className={`w-6 h-6 ${hasInspiration ? 'text-infinite-gold animate-pulse' : 'text-muted-foreground'}`}
              />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-muted-foreground" />
                <span className="font-medium">Inspiration</span>
                <Badge variant={hasInspiration ? 'default' : 'secondary'}>
                  {hasInspiration ? 'Active' : 'None'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                {hasInspiration ? 'Click to use for advantage' : 'Roleplay your traits to earn'}
              </p>
            </div>
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant={hasInspiration ? 'default' : 'outline'}
                size="sm"
                onClick={toggleInspiration}
                className={
                  hasInspiration ? 'bg-infinite-gold hover:bg-infinite-purple text-infinite-dark' : ''
                }
                aria-pressed={hasInspiration}
                aria-label={hasInspiration ? 'Use inspiration' : 'Award inspiration'}
              >
                {hasInspiration ? (
                  <>
                    <Sparkles className="w-4 h-4 mr-1" />
                    Use
                  </>
                ) : (
                  'Award'
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{hasInspiration ? 'Use inspiration' : 'Award inspiration'}</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {hasInspiration && (
          <div className="mt-3 p-2 bg-infinite-gold/15 rounded text-xs text-infinite-gold">
            <strong>Inspiration:</strong> Spend to gain advantage on one ability check, attack roll,
            or saving throw.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default InspirationTracker;
