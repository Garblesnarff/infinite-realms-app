import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

const schoolColors: Record<string, string> = {
  Abjuration: 'bg-blue-100 text-blue-800 hover:bg-blue-200',
  Conjuration: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200',
  Divination: 'bg-purple-100 text-purple-800 hover:bg-purple-200',
  Enchantment: 'bg-pink-100 text-pink-800 hover:bg-pink-200',
  Evocation: 'bg-red-100 text-red-800 hover:bg-red-200',
  Illusion: 'bg-indigo-100 text-indigo-800 hover:bg-indigo-200',
  Necromancy: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
  Transmutation: 'bg-green-100 text-green-800 hover:bg-green-200',
};

interface SchoolFiltersListProps {
  availableSchools: string[];
  selectedSchools: string[];
  onToggleSchool: (school: string) => void;
  handleKeyDown: (e: React.KeyboardEvent, callback: () => void) => void;
  schoolsLabelId: string;
}

export const SchoolFiltersList: React.FC<SchoolFiltersListProps> = ({
  availableSchools,
  selectedSchools,
  onToggleSchool,
  handleKeyDown,
  schoolsLabelId,
}) => {
  return (
    <div className="space-y-2" role="group" aria-labelledby={schoolsLabelId}>
      <Label id={schoolsLabelId} className="text-sm font-medium">
        Schools of Magic
      </Label>
      <div className="flex flex-wrap gap-2">
        {availableSchools.map((school) => {
          const isSelected = selectedSchools.includes(school);
          const colorClass = schoolColors[school] || 'bg-gray-100 text-gray-800';

          return (
            <Tooltip key={school}>
              <TooltipTrigger asChild>
                <Badge
                  variant={isSelected ? 'default' : 'outline'}
                  className={`cursor-pointer transition-colors focus-visible:ring-2 focus-visible:ring-primary outline-none ${
                    isSelected ? colorClass : 'hover:bg-muted'
                  }`}
                  onClick={() => onToggleSchool(school)}
                  onKeyDown={(e) => handleKeyDown(e, () => onToggleSchool(school))}
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={`Filter by ${school}`}
                  tabIndex={0}
                >
                  {school}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Filter by {school}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
};
