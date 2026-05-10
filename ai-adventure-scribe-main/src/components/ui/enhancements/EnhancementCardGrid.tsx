import React from 'react';

import type { EnhancementOption, OptionSelection } from '@/types/enhancement-options';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

interface EnhancementCardGridProps {
  option: EnhancementOption;
  selection: OptionSelection | undefined;
  onSelectionChange: (selection: OptionSelection) => void;
  isAvailable: boolean;
  isSelected: boolean;
  viewMode: 'grid' | 'list' | 'compact';
}

/**
 * EnhancementCardGrid Component
 *
 * Extracted from EnhancementPanel.tsx
 * Renders a grid of selectable cards for an enhancement option's values.
 */
export function EnhancementCardGrid({
  option,
  selection,
  onSelectionChange,
  isAvailable,
  isSelected,
  viewMode,
}: EnhancementCardGridProps): JSX.Element | null {
  if (!option.options || option.options.length === 0) {
    return null;
  }

  const max = option.max || (option.type === 'multiple' ? Infinity : 1);
  const selectedValues: string[] = Array.isArray(selection?.value)
    ? (selection.value as string[])
    : selection?.value
      ? [selection.value as string]
      : [];
  const atMax = selectedValues.length >= max;

  const onToggle = (opt: string): void => {
    if (!isAvailable && !isSelected) {
      return;
    }

    if (option.type === 'multiple') {
      const isAlready = selectedValues.includes(opt);
      if (isAlready) {
        onSelectionChange({
          optionId: option.id,
          value: selectedValues.filter((v) => v !== opt) as OptionSelection['value'],
          timestamp: new Date().toISOString(),
        });
      } else if (!atMax) {
        onSelectionChange({
          optionId: option.id,
          value: [...selectedValues, opt] as OptionSelection['value'],
          timestamp: new Date().toISOString(),
        });
      }
    } else {
      onSelectionChange({
        optionId: option.id,
        value: opt as unknown as OptionSelection['value'],
        timestamp: new Date().toISOString(),
      });
    }
  };

  return (
    <div className="space-y-3">
      {option.max && option.type === 'multiple' && (
        <div className="text-xs text-muted-foreground mb-1">
          Select up to {option.max} options ({selectedValues.length}/{option.max} selected)
        </div>
      )}
      <div
        role={option.type === 'multiple' ? 'group' : 'radiogroup'}
        aria-label={option.name}
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {option.options.map((opt) => {
          const isChecked =
            option.type === 'multiple'
              ? selectedValues.includes(opt)
              : (selection?.value as string) === opt;
          const canSelect = option.type === 'multiple' ? isChecked || !atMax : true;

          return (
            <Card
              key={opt}
              role={option.type === 'multiple' ? 'checkbox' : 'radio'}
              aria-checked={isChecked}
              aria-disabled={!canSelect || (!isAvailable && !isSelected)}
              tabIndex={0}
              className={`w-full cursor-pointer transition-all rounded-lg border-2 ${
                isChecked
                  ? 'border-primary bg-primary/5 shadow-lg ring-2 ring-primary/30'
                  : !canSelect || (!isAvailable && !isSelected)
                    ? 'border-border/60 opacity-60 cursor-not-allowed'
                    : 'border-border/30 hover:border-primary/50 hover:shadow-xl'
              } ${viewMode === 'compact' ? 'p-4' : 'p-6'} hover:-translate-y-0.5`}
              onClick={() => {
                if (canSelect) {
                  onToggle(opt);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (canSelect) {
                    onToggle(opt);
                  }
                }
              }}
            >
              <div className="flex flex-col gap-2">
                <span
                  className={`${viewMode === 'compact' ? 'text-sm' : 'text-base'} font-medium leading-snug`}
                >
                  {opt}
                </span>
                {isChecked && (
                  <Badge variant="secondary" className="text-[10px]">
                    Selected
                  </Badge>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
