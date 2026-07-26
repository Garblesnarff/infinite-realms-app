import { X } from 'lucide-react';
import React from 'react';

import type { SpellFilters } from '@/components/spells/spell-filter/types';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';


interface ActiveFiltersSummaryProps {
  filters: SpellFilters;
  onToggleSchool: (school: string) => void;
  onToggleComponent: (component: keyof SpellFilters['components']) => void;
  onToggleProperty: (property: keyof SpellFilters['properties']) => void;
  handleKeyDown: (e: React.KeyboardEvent, callback: () => void) => void;
  activeFiltersLabelId: string;
}

export const ActiveFiltersSummary: React.FC<ActiveFiltersSummaryProps> = ({
  filters,
  onToggleSchool,
  onToggleComponent,
  onToggleProperty,
  handleKeyDown,
  activeFiltersLabelId,
}) => {
  return (
    <div className="space-y-2" role="group" aria-labelledby={activeFiltersLabelId}>
      <Label id={activeFiltersLabelId} className="text-sm font-medium">
        Active Filters
      </Label>
      <div className="flex flex-wrap gap-1">
        {filters.schools.map((school) => (
          <Tooltip key={school}>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className="text-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-primary outline-none"
                onClick={() => onToggleSchool(school)}
                onKeyDown={(e) => handleKeyDown(e, () => onToggleSchool(school))}
                role="button"
                aria-label={`Remove ${school} filter`}
                tabIndex={0}
              >
                {school}
                <X className="w-3 h-3 ml-1" />
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              <p>Remove {school} filter</p>
            </TooltipContent>
          </Tooltip>
        ))}
        {Object.entries(filters.components).map(
          ([component, active]) =>
            active && (
              <Tooltip key={component}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="secondary"
                    className="text-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-primary outline-none"
                    onClick={() =>
                      onToggleComponent(component as keyof SpellFilters['components'])
                    }
                    onKeyDown={(e) =>
                      handleKeyDown(e, () =>
                        onToggleComponent(component as keyof SpellFilters['components']),
                      )
                    }
                    role="button"
                    aria-label={`Remove ${component} filter`}
                    tabIndex={0}
                  >
                    {component.charAt(0).toUpperCase()}
                    <X className="w-3 h-3 ml-1" />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Remove {component} filter</p>
                </TooltipContent>
              </Tooltip>
            ),
        )}
        {Object.entries(filters.properties).map(
          ([property, active]) =>
            active && (
              <Tooltip key={property}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="secondary"
                    className="text-xs cursor-pointer focus-visible:ring-2 focus-visible:ring-primary outline-none"
                    onClick={() =>
                      onToggleProperty(property as keyof SpellFilters['properties'])
                    }
                    onKeyDown={(e) =>
                      handleKeyDown(e, () =>
                        onToggleProperty(property as keyof SpellFilters['properties']),
                      )
                    }
                    role="button"
                    aria-label={`Remove ${property} filter`}
                    tabIndex={0}
                  >
                    {property}
                    <X className="w-3 h-3 ml-1" />
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Remove {property} filter</p>
                </TooltipContent>
              </Tooltip>
            ),
        )}
      </div>
    </div>
  );
};
