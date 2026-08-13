/**
 * Option Selector Component
 *
 * Reusable UI component for selecting enhancement options during
 * character and campaign creation.
 */

import { Sparkles } from 'lucide-react';
import React from 'react';

import { MechanicalEffectsDisplay } from './MechanicalEffectsDisplay';
import { OptionInput } from './OptionInput';

import type { EnhancementOption, OptionSelection, OptionType } from '@/types/enhancement-options';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import logger from '@/lib/logger';
import { validateOptionSelection } from '@/types/enhancement-options';

interface OptionSelectorProps<T extends OptionType = OptionType> {
  option: EnhancementOption<T>;
  value?: OptionSelection<T>;
  onChange: (selection: OptionSelection<T>) => void;
  disabled?: boolean;
  showMechanicalEffects?: boolean;
  onAIGenerate?: (optionId: string) => Promise<string>;
  isGenerating?: boolean;
  compact?: boolean;
  itemLayout?: 'list' | 'cards';
}

/**
 * Main OptionSelector component.
 * Orchestrates the selection of enhancement options using sub-components.
 */
export function OptionSelector<T extends OptionType = OptionType>({
  option,
  value,
  onChange,
  disabled = false,
  showMechanicalEffects = true,
  onAIGenerate,
  isGenerating = false,
  compact = false,
  itemLayout = 'list',
}: OptionSelectorProps<T>) {
  const [customValue, setCustomValue] = React.useState(value?.customValue || '');
  const headerId = React.useId();

  const handleValueChange = (newValue: OptionSelection<T>['value']) => {
    const selection: OptionSelection<T> = {
      optionId: option.id,
      value: newValue,
      customValue: customValue || undefined,
      timestamp: new Date().toISOString(),
    };

    if (validateOptionSelection(option, selection)) {
      onChange(selection);
    }
  };

  const handleCustomValueChange = (newCustomValue: string) => {
    setCustomValue(newCustomValue);
    if (value) {
      onChange({
        ...value,
        customValue: newCustomValue || undefined,
      });
    }
  };

  const handleAIGenerate = async () => {
    if (onAIGenerate) {
      try {
        const generated = await onAIGenerate(option.id);
        const selection: OptionSelection<T> = {
          optionId: option.id,
          value: generated as unknown as OptionSelection<T>['value'],
          aiGenerated: true,
          timestamp: new Date().toISOString(),
        };
        onChange(selection);
      } catch (error) {
        logger.error('Failed to generate AI content:', error);
      }
    }
  };

  return (
    <Card
      className={`transition-all duration-200 ${disabled ? 'opacity-60' : 'hover:shadow-md'} ${compact ? 'p-2' : ''}`}
    >
      <CardHeader className={compact ? 'py-2' : 'pb-3'}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            {option.icon && <span className="text-lg">{option.icon}</span>}
            <CardTitle className={compact ? 'text-sm' : 'text-base'}>{option.name}</CardTitle>
            {option.aiGenerated && (
              <Badge variant="outline" className="text-xs">
                <Sparkles className="w-3 h-3 mr-1" />
                AI
              </Badge>
            )}
          </div>
        </div>
        <CardDescription className={compact ? 'text-xs' : 'text-sm'}>
          {option.description}
        </CardDescription>
      </CardHeader>

      <CardContent className={compact ? 'space-y-2 pt-0' : 'space-y-4'}>
        <OptionInput
          option={option}
          value={value}
          disabled={disabled}
          isGenerating={isGenerating}
          itemLayout={itemLayout}
          compact={compact}
          headerId={headerId}
          handleValueChange={handleValueChange}
          handleAIGenerate={handleAIGenerate}
        />

        {/* Custom value input for additional details */}
        {option.type !== 'text' && (
          <div className="space-y-2">
            <Label
              htmlFor={`${option.id}-custom`}
              className={compact ? 'text-xs font-medium' : 'text-sm font-medium'}
            >
              Additional Notes (Optional)
            </Label>
            <Input
              id={`${option.id}-custom`}
              value={customValue}
              onChange={(e) => handleCustomValueChange(e.target.value)}
              disabled={disabled}
              placeholder="Add custom details or modifications..."
              className={compact ? 'text-xs h-8' : 'text-sm'}
            />
          </div>
        )}

        <MechanicalEffectsDisplay option={option} showMechanicalEffects={showMechanicalEffects} />
      </CardContent>
    </Card>
  );
}
