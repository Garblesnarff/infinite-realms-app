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

import { Search } from 'lucide-react';
import React, { useState } from 'react';

import { BUILT_IN_TEMPLATES, type SceneTemplate } from './scene-templates';
import { SceneTemplateCard } from './SceneTemplateCard';

import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface SceneTemplateLibraryProps {
  onSelectTemplate?: (template: SceneTemplate) => void;
  selectedTemplateId?: string;
}

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
          {filteredTemplates.map((template) => (
            <SceneTemplateCard
              key={template.id}
              template={template}
              isSelected={template.id === selectedTemplateId}
              onSelectTemplate={onSelectTemplate}
            />
          ))}
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
