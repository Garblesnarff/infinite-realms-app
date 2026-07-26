import { Filter, X, Eye, Hand, Gem, Timer, RotateCcw, Zap } from 'lucide-react';
import React, { useCallback, useId } from 'react';

import type { SpellFilters } from '@/components/spells/spell-filter/types';

import { ActiveFiltersSummary } from '@/components/spells/spell-filter/ActiveFiltersSummary';
import { SchoolFiltersList } from '@/components/spells/spell-filter/SchoolFiltersList';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { TooltipProvider } from '@/components/ui/tooltip';

export type { SpellFilters };

interface SpellFilterPanelProps {
  filters: SpellFilters;
  onChange: (filters: SpellFilters) => void;
  availableSchools: string[];
  isOpen?: boolean;
  className?: string;
}

/**
 * SpellFilterPanel - Advanced filtering interface for spells
 * Features:
 * - Filter by spell school with multi-select
 * - Component requirement filters (V, S, M)
 * - Special property filters (concentration, ritual, damage)
 * - Clear all filters functionality
 * - Visual filter indicators
 * - Collapsible design for mobile
 */
const SpellFilterPanel: React.FC<SpellFilterPanelProps> = ({
  filters,
  onChange,
  availableSchools,
  isOpen = true,
  className = '',
}) => {
  const schoolsLabelId = useId();
  const componentsLabelId = useId();
  const propertiesLabelId = useId();
  const activeFiltersLabelId = useId();

  const verbalId = useId();
  const somaticId = useId();
  const materialId = useId();
  const concentrationId = useId();
  const ritualId = useId();
  const damageId = useId();

  const handleKeyDown = useCallback((e: React.KeyboardEvent, callback: () => void): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      callback();
    }
  }, []);

  const toggleSchool = (school: string): void => {
    const newSchools = filters.schools.includes(school)
      ? filters.schools.filter((s) => s !== school)
      : [...filters.schools, school];

    onChange({
      ...filters,
      schools: newSchools,
    });
  };

  const toggleComponent = (component: keyof SpellFilters['components']): void => {
    onChange({
      ...filters,
      components: {
        ...filters.components,
        [component]: !filters.components[component],
      },
    });
  };

  const toggleProperty = (property: keyof SpellFilters['properties']): void => {
    onChange({
      ...filters,
      properties: {
        ...filters.properties,
        [property]: !filters.properties[property],
      },
    });
  };

  const clearAllFilters = (): void => {
    onChange({
      schools: [],
      components: {
        verbal: false,
        somatic: false,
        material: false,
      },
      properties: {
        concentration: false,
        ritual: false,
        damage: false,
      },
    });
  };

  const hasActiveFilters =
    filters.schools.length > 0 ||
    Object.values(filters.components).some(Boolean) ||
    Object.values(filters.properties).some(Boolean);

  if (!isOpen) {
    return null;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Card className={className}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Filter className="w-4 h-4" />
              Filters
            </CardTitle>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-xs h-7">
                <X className="w-3 h-3 mr-1" />
                Clear All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* School Filters */}
          <SchoolFiltersList
            availableSchools={availableSchools}
            selectedSchools={filters.schools}
            onToggleSchool={toggleSchool}
            handleKeyDown={handleKeyDown}
            schoolsLabelId={schoolsLabelId}
          />

          <Separator />

          {/* Component Filters */}
          <div className="space-y-3" role="group" aria-labelledby={componentsLabelId}>
            <Label id={componentsLabelId} className="text-sm font-medium">
              Components Required
            </Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={verbalId}
                  checked={filters.components.verbal}
                  onCheckedChange={() => toggleComponent('verbal')}
                />
                <Label
                  htmlFor={verbalId}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Eye className="w-4 h-4 text-blue-500" />
                  Verbal (V)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={somaticId}
                  checked={filters.components.somatic}
                  onCheckedChange={() => toggleComponent('somatic')}
                />
                <Label
                  htmlFor={somaticId}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Hand className="w-4 h-4 text-green-500" />
                  Somatic (S)
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={materialId}
                  checked={filters.components.material}
                  onCheckedChange={() => toggleComponent('material')}
                />
                <Label
                  htmlFor={materialId}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Gem className="w-4 h-4 text-purple-500" />
                  Material (M)
                </Label>
              </div>
            </div>
          </div>

          <Separator />

          {/* Property Filters */}
          <div className="space-y-3" role="group" aria-labelledby={propertiesLabelId}>
            <Label id={propertiesLabelId} className="text-sm font-medium">
              Special Properties
            </Label>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={concentrationId}
                  checked={filters.properties.concentration}
                  onCheckedChange={() => toggleProperty('concentration')}
                />
                <Label
                  htmlFor={concentrationId}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Timer className="w-4 h-4 text-orange-500" />
                  Concentration
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={ritualId}
                  checked={filters.properties.ritual}
                  onCheckedChange={() => toggleProperty('ritual')}
                />
                <Label
                  htmlFor={ritualId}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4 text-indigo-500" />
                  Ritual
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <Checkbox
                  id={damageId}
                  checked={filters.properties.damage}
                  onCheckedChange={() => toggleProperty('damage')}
                />
                <Label
                  htmlFor={damageId}
                  className="flex items-center gap-2 text-sm cursor-pointer"
                >
                  <Zap className="w-4 h-4 text-red-500" />
                  Deals Damage
                </Label>
              </div>
            </div>
          </div>

          {/* Active Filters Summary */}
          {hasActiveFilters && (
            <>
              <Separator />
              <ActiveFiltersSummary
                filters={filters}
                onToggleSchool={toggleSchool}
                onToggleComponent={toggleComponent}
                onToggleProperty={toggleProperty}
                handleKeyDown={handleKeyDown}
                activeFiltersLabelId={activeFiltersLabelId}
              />
            </>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
};

export default SpellFilterPanel;
