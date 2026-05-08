import { Sparkles, Loader2 } from 'lucide-react';
import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import type { EnhancementOption, OptionSelection, OptionType } from '@/types/enhancement-options';

interface OptionInputProps<T extends OptionType = OptionType> {
  option: EnhancementOption<T>;
  value?: OptionSelection<T>;
  disabled: boolean;
  isGenerating: boolean;
  itemLayout: 'list' | 'cards';
  compact: boolean;
  headerId: string;
  handleValueChange: (newValue: OptionSelection<T>['value']) => void;
  handleAIGenerate: () => Promise<void>;
}

/**
 * Component for rendering the specific input control based on enhancement option type.
 * Extracted from OptionSelector.
 */
export function OptionInput<T extends OptionType = OptionType>({
  option,
  value,
  disabled,
  isGenerating,
  itemLayout,
  compact,
  headerId,
  handleValueChange,
  handleAIGenerate,
}: OptionInputProps<T>) {
  switch (option.type) {
    case 'single':
      if (option.aiGenerated) {
        return (
          <div className="space-y-4">
            <Button
              onClick={handleAIGenerate}
              disabled={disabled || isGenerating}
              className="w-full"
              variant="outline"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 mr-2" />
                  Generate with AI
                </>
              )}
            </Button>
            {value?.value && (
              <div className="p-3 bg-muted rounded-md">
                <p className="text-sm">{value.value as string}</p>
                {value.aiGenerated && (
                  <Badge variant="secondary" className="mt-2">
                    AI Generated
                  </Badge>
                )}
              </div>
            )}
          </div>
        );
      }

      // Cards layout for single-choice options
      if (itemLayout === 'cards' && option.options && option.options.length > 0) {
        const selected = (value?.value as string) || '';
        return (
          <div
            role="radiogroup"
            aria-labelledby={headerId}
            className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`}
          >
            {option.options.map((opt) => {
              const isSelected = selected === opt;
              return (
                <Card
                  key={opt}
                  role="radio"
                  aria-checked={isSelected}
                  tabIndex={0}
                  aria-disabled={disabled}
                  className={`w-full cursor-pointer transition-all rounded-lg border-2 ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-lg ring-2 ring-primary/30'
                      : 'border-border/30 hover:border-primary/50 hover:shadow-xl'
                  } ${compact ? 'p-4' : 'p-6'} hover:-translate-y-0.5`}
                  onClick={() => !disabled && handleValueChange(opt)}
                  onKeyDown={(e) => {
                    if (disabled) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleValueChange(opt);
                    }
                  }}
                >
                  <div className="flex flex-col gap-2">
                    <span
                      className={`${compact ? 'text-sm' : 'text-base'} font-medium leading-snug`}
                    >
                      {opt}
                    </span>
                    {isSelected && (
                      <Badge variant="secondary" className="text-[10px]">
                        Selected
                      </Badge>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        );
      }

      return (
        <RadioGroup
          value={(value?.value as string) || ''}
          onValueChange={handleValueChange}
          disabled={disabled}
          className="space-y-2"
        >
          {option.options?.map((optionValue) => (
            <div key={optionValue} className="flex items-center space-x-2">
              <RadioGroupItem value={optionValue} id={`${option.id}-${optionValue}`} />
              <Label htmlFor={`${option.id}-${optionValue}`} className="text-sm cursor-pointer">
                {optionValue}
              </Label>
            </div>
          ))}
        </RadioGroup>
      );

    case 'multiple': {
      const selectedValues = (value?.value as string[]) || [];
      const maxSelections = option.max || Infinity;

      // Cards layout for multiple-choice options
      if (itemLayout === 'cards' && option.options && option.options.length > 0) {
        const atMax = selectedValues.length >= maxSelections;
        return (
          <div className="space-y-2">
            {option.max && (
              <p className="text-xs text-muted-foreground mb-1">
                Select up to {option.max} options ({selectedValues.length}/{option.max} selected)
              </p>
            )}
            <div
              role="group"
              aria-labelledby={headerId}
              className={`grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4`}
            >
              {option.options.map((opt) => {
                const isSelected = selectedValues.includes(opt);
                const canSelect = isSelected || !atMax;
                return (
                  <Card
                    key={opt}
                    role="checkbox"
                    aria-checked={isSelected}
                    aria-disabled={disabled || !canSelect}
                    tabIndex={0}
                    className={`w-full cursor-pointer transition-all rounded-lg border-2 ${
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-lg ring-2 ring-primary/30'
                        : disabled || !canSelect
                          ? 'border-border/60 opacity-60 cursor-not-allowed'
                          : 'border-border/30 hover:border-primary/50 hover:shadow-xl'
                    } ${compact ? 'p-4' : 'p-6'} hover:-translate-y-0.5`}
                    onClick={() => {
                      if (disabled || (!canSelect && !isSelected)) return;
                      if (isSelected) {
                        handleValueChange(selectedValues.filter((v) => v !== opt));
                      } else {
                        handleValueChange([...selectedValues, opt]);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (disabled || (!canSelect && !isSelected)) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (isSelected) {
                          handleValueChange(selectedValues.filter((v) => v !== opt));
                        } else {
                          handleValueChange([...selectedValues, opt]);
                        }
                      }
                    }}
                  >
                    <div className="flex flex-col gap-2">
                      <span
                        className={`${compact ? 'text-sm' : 'text-base'} font-medium leading-snug`}
                      >
                        {opt}
                      </span>
                      {isSelected && (
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

      // Default list layout
      return (
        <div className="space-y-2">
          {option.max && (
            <p className="text-xs text-muted-foreground">
              Select up to {option.max} options ({selectedValues.length}/{option.max} selected)
            </p>
          )}
          {option.options?.map((optionValue) => {
            const isSelected = selectedValues.includes(optionValue);
            const canSelect = isSelected || selectedValues.length < maxSelections;

            return (
              <div key={optionValue} className="flex items-center space-x-2">
                <Checkbox
                  id={`${option.id}-${optionValue}`}
                  checked={isSelected}
                  disabled={disabled || !canSelect}
                  onCheckedChange={(checked) => {
                    if (checked) {
                      handleValueChange([...selectedValues, optionValue]);
                    } else {
                      handleValueChange(selectedValues.filter((v) => v !== optionValue));
                    }
                  }}
                />
                <Label
                  htmlFor={`${option.id}-${optionValue}`}
                  className={`text-sm cursor-pointer ${!canSelect && !isSelected ? 'text-muted-foreground' : ''}`}
                >
                  {optionValue}
                </Label>
              </div>
            );
          })}
        </div>
      );
    }

    case 'number':
      return (
        <div className="space-y-2">
          <Input
            type="number"
            min={option.min}
            max={option.max}
            value={(value?.value as number) || ''}
            onChange={(e) => handleValueChange(parseInt(e.target.value) || 0)}
            disabled={disabled}
            placeholder={`${option.min || 0} - ${option.max || '∞'}`}
          />
          {(option.min !== undefined || option.max !== undefined) && (
            <p className="text-xs text-muted-foreground">
              Range: {option.min || 0} to {option.max || '∞'}
            </p>
          )}
        </div>
      );

    case 'text':
      return (
        <Textarea
          value={(value?.value as string) || ''}
          onChange={(e) => handleValueChange(e.target.value)}
          disabled={disabled}
          placeholder="Enter your custom text..."
          rows={3}
        />
      );

    default:
      return null;
  }
}
