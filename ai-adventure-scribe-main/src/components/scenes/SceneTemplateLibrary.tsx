/* eslint-disable max-lines -- pre-existing length; restyle-only change. Tracked for decomposition. */
/**
 * Scene Template Library Component
 *
 * Built-in scene templates for quick scene creation:
 * - Tavern
 * - Forest
 * - Dungeon
 * - Castle
 * - Cave
 * - Town Square
 * - And more...
 */

import { Search, Check } from 'lucide-react';
import React, { useState } from 'react';

import { BUILT_IN_TEMPLATES, type SceneTemplate } from './scene-templates';

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
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SceneTemplateLibraryProps {
  onSelectTemplate?: (template: SceneTemplate) => void;
  selectedTemplateId?: string;
}

const CATEGORY_COLORS = {
  interior: 'bg-infinite-gold/15 text-infinite-gold border border-infinite-gold/30',
  exterior: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  dungeon: 'bg-white/10 text-muted-foreground border border-white/10',
  wilderness: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30',
  urban: 'bg-infinite-teal/15 text-infinite-teal border border-infinite-teal/30',
};

export const SceneTemplateLibrary: React.FC<SceneTemplateLibraryProps> = ({
  onSelectTemplate,
  selectedTemplateId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categories = Array.from(new Set(BUILT_IN_TEMPLATES.map((t) => t.category)));

  const filteredTemplates = BUILT_IN_TEMPLATES.filter((template) => {
    const matchesSearch =
      !searchQuery ||
      template.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      template.description.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = !selectedCategory || template.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  const handleKeyDown = (e: React.KeyboardEvent, template: SceneTemplate): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelectTemplate?.(template);
    }
  };

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-4">
          <div className="flex-1 relative">
            <Search
              className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              placeholder="Search templates..."
              aria-label="Search scene templates"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          <div
            className="flex gap-2 flex-wrap"
            role="group"
            aria-label="Filter templates by category"
          >
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant={selectedCategory === null ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setSelectedCategory(null)}
                  aria-pressed={selectedCategory === null}
                  aria-label="Show all templates"
                >
                  All
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Show all templates</p>
              </TooltipContent>
            </Tooltip>

            {categories.map((category) => (
              <Tooltip key={category} delayDuration={300}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant={selectedCategory === category ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedCategory(category)}
                    className="capitalize"
                    aria-pressed={selectedCategory === category}
                    aria-label={`Show ${category} templates`}
                  >
                    {category}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Show {category} templates</p>
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>

        {/* Template Grid */}
        <div
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
          role="radiogroup"
          aria-label="Scene templates"
        >
          {filteredTemplates.map((template) => {
            const isSelected = template.id === selectedTemplateId;

            return (
              <Card
                key={template.id}
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
                onKeyDown={(e) => handleKeyDown(e, template)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-5xl mb-2" aria-hidden="true">
                      {template.thumbnailEmoji}
                    </div>
                    {isSelected && (
                      <div
                        className="bg-electricCyan text-white rounded-full p-1"
                        aria-hidden="true"
                      >
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
                      <p className="font-medium capitalize">
                        {template.gridType.replace('_', ' ')}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Light</p>
                      <p className="font-medium">
                        {Math.round(parseFloat(template.suggestedSettings.ambientLightLevel) * 100)}
                        %
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Time</p>
                      <p className="font-medium capitalize">
                        {template.suggestedSettings.timeOfDay}
                      </p>
                    </div>
                  </div>

                  <div className="flex gap-2 text-xs">
                    {template.suggestedSettings.enableFogOfWar && (
                      <Badge variant="outline">Fog of War</Badge>
                    )}
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
          })}
        </div>

        {/* Empty State */}
        {filteredTemplates.length === 0 && (
          <Card variant="parchment" className="p-12 text-center" role="status" aria-live="polite">
            <div className="text-6xl mb-4" aria-hidden="true">
              🔍
            </div>
            <CardTitle className="mb-2">No Templates Found</CardTitle>
            <CardDescription>
              Try adjusting your search or filter to find templates.
            </CardDescription>
          </Card>
        )}
      </div>
    </TooltipProvider>
  );
};
