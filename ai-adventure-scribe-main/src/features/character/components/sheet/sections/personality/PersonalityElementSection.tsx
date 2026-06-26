import {
  AlertTriangle,
  Anchor,
  Brain,
  Heart,
  Plus,
  Trash2,
} from 'lucide-react';
import React from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export type PersonalityElementType = 'trait' | 'ideal' | 'bond' | 'flaw';

interface PersonalityElementSectionProps {
  type: PersonalityElementType;
  items: string[];
  newValue: string;
  setNewValue: (value: string) => void;
  placeholder: string;
  textareaId: string;
  addPersonalityElement: (type: PersonalityElementType, value: string) => void;
  removePersonalityElement: (type: PersonalityElementType, index: number) => void;
}

/**
 * Get icon for personality element type
 */
const getPersonalityIcon = (type: string): React.ElementType => {
  switch (type) {
    case 'trait':
      return Heart;
    case 'ideal':
      return Brain;
    case 'bond':
      return Anchor;
    case 'flaw':
      return AlertTriangle;
    default:
      return Heart;
  }
};

/**
 * Get color for personality element type
 */
const getPersonalityColor = (type: string): string => {
  switch (type) {
    case 'trait':
      return 'text-red-500';
    case 'ideal':
      return 'text-blue-500';
    case 'bond':
      return 'text-green-500';
    case 'flaw':
      return 'text-orange-500';
    default:
      return 'text-gray-500';
  }
};

/**
 * Reusable personality element list component
 */
export const PersonalityElementSection: React.FC<PersonalityElementSectionProps> = ({
  type,
  items,
  newValue,
  setNewValue,
  placeholder,
  textareaId,
  addPersonalityElement,
  removePersonalityElement,
}) => {
  const Icon = getPersonalityIcon(type);
  const colorClass = getPersonalityColor(type);

  return (
    <Card>
      <CardHeader>
        <CardTitle className={`flex items-center gap-2 ${colorClass}`}>
          <Icon className="w-5 h-5" />
          {type.charAt(0).toUpperCase() + type.slice(1)}s
          <Badge variant="outline" className="ml-auto">
            {items.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {items.map((item, index) => (
            <div key={index} className="flex items-start gap-3 p-3 border rounded-lg">
              <div className="flex-1">
                <p className="text-sm">{item}</p>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removePersonalityElement(type, index)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                    aria-label={`Remove ${type}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Remove {type}</p>
                </TooltipContent>
              </Tooltip>
            </div>
          ))}

          <div className="flex gap-2">
            <div className="flex-1 space-y-2">
              <Label htmlFor={textareaId} className="sr-only">
                Add new {type}
              </Label>
              <Textarea
                id={textareaId}
                placeholder={placeholder}
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                className="w-full"
                rows={2}
                aria-label={`Add new ${type}`}
              />
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  onClick={() => addPersonalityElement(type, newValue)}
                  disabled={!newValue.trim()}
                  className="mt-auto"
                  aria-label={`Add ${type}`}
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Add {type}</p>
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
