import { Check } from 'lucide-react';
import React from 'react';

import { type SceneTemplate } from './scene-templates';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { cn } from '@/lib/utils';

const CATEGORY_COLORS = {
  interior: 'bg-infinite-gold/15 text-infinite-gold border border-infinite-gold/30',
  exterior: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  dungeon: 'bg-white/10 text-muted-foreground border border-white/10',
  wilderness: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  urban: 'bg-infinite-teal/15 text-infinite-teal border border-infinite-teal/30',
};

interface SceneTemplateCardProps {
  template: SceneTemplate;
  isSelected: boolean;
  onSelectTemplate?: (template: SceneTemplate) => void;
}

export const SceneTemplateCard: React.FC<SceneTemplateCardProps> = ({
  template,
  isSelected,
  onSelectTemplate,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectTemplate?.(template);
    }
  };

  return (
    <Card
      variant="parchment"
      role="radio"
      aria-checked={isSelected}
      tabIndex={0}
      aria-label={template.name}
      className={cn(
        'cursor-pointer transition-all hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple',
        isSelected && 'ring-2 ring-electricCyan shadow-lg shadow-electricCyan/50',
      )}
      onClick={() => onSelectTemplate?.(template)}
      onKeyDown={handleKeyDown}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="text-5xl mb-2" aria-hidden="true">
            {template.thumbnailEmoji}
          </div>
          {isSelected && (
            <div className="bg-electricCyan text-white rounded-full p-1" aria-hidden="true">
              <Check className="h-4 w-4" />
            </div>
          )}
        </div>
        <CardTitle className="text-lg">{template.name}</CardTitle>
        <CardDescription className="text-sm">{template.description}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        <Badge className={CATEGORY_COLORS[template.category]}>{template.category}</Badge>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-muted-foreground">Size</p>
            <p className="font-medium">
              {template.width} × {template.height}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Grid</p>
            <p className="font-medium capitalize">{template.gridType.replace('_', ' ')}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Light</p>
            <p className="font-medium">
              {Math.round(parseFloat(template.suggestedSettings.ambientLightLevel) * 100)}%
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">Time</p>
            <p className="font-medium capitalize">{template.suggestedSettings.timeOfDay}</p>
          </div>
        </div>

        <div className="flex gap-2 text-xs">
          {template.suggestedSettings.enableFogOfWar && <Badge variant="outline">Fog of War</Badge>}
          {template.suggestedSettings.enableDynamicLighting && (
            <Badge variant="outline">Dynamic Light</Badge>
          )}
        </div>
      </CardContent>

      <CardFooter className="pt-0">
        <Button
          type="button"
          variant={isSelected ? 'default' : 'outline'}
          className="w-full"
          tabIndex={-1}
          aria-hidden="true"
          onClick={(e) => {
            e.stopPropagation();
            onSelectTemplate?.(template);
          }}
          aria-pressed={isSelected}
          aria-label={isSelected ? 'Template selected' : 'Use this template'}
        >
          {isSelected ? 'Selected' : 'Use Template'}
        </Button>
      </CardFooter>
    </Card>
  );
};
