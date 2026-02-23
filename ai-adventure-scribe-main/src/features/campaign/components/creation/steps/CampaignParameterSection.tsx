import { Check, type LucideIcon } from 'lucide-react';
import React, { useId } from 'react';

import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Z_INDEX } from '@/constants/z-index';

export interface ParameterOption {
  value: string;
  label: string;
  colorClass?: string;
  icon?: React.ReactNode;
}

interface CampaignParameterSectionProps {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  options: ParameterOption[];
  selectedValue: string;
  onValueChange: (value: string) => void;
  viewMode: 'grid' | 'list' | 'compact';
  matchesSearch: (label: string) => boolean;
}

/**
 * Extracted from CampaignParameters.tsx
 * Handles the rendering of a single campaign parameter section with multiple view modes.
 */
const CampaignParameterSection: React.FC<CampaignParameterSectionProps> = ({
  id,
  title,
  description,
  icon: SectionIcon,
  options,
  selectedValue,
  onValueChange,
  viewMode,
  matchesSearch,
}) => {
  const labelId = useId();

  return (
    <div>
      <div className="text-center mb-6">
        <Label
          id={labelId}
          className="text-xl font-serif font-semibold flex items-center justify-center"
        >
          <SectionIcon className="h-5 w-5 mr-2 text-blue-600" />
          {title}
        </Label>
        <p className="text-sm text-muted-foreground mt-2">{description}</p>
      </div>
      <RadioGroup
        aria-labelledby={labelId}
        value={selectedValue}
        onValueChange={onValueChange}
        className={
          viewMode === 'grid'
            ? 'grid grid-cols-1 md:grid-cols-3 gap-4'
            : viewMode === 'list'
              ? 'space-y-4'
              : 'grid grid-cols-1 md:grid-cols-3 gap-3'
        }
      >
        {options
          .filter((option) => matchesSearch(option.label))
          .map((option) => {
            const isSelected = selectedValue === option.value;
            const colorClass = option.colorClass || 'text-foreground';

            // Use provided icon or fallback to section icon
            const icon = option.icon || <SectionIcon className="h-5 w-5" />;

            // Compact version of the icon (reduced size)
            const compactIcon = option.icon
              ? React.cloneElement(option.icon as React.ReactElement, {
                  className: 'h-4 w-4',
                })
              : <SectionIcon className="h-4 w-4" />;

            if (viewMode === 'list') {
              return (
                <Card
                  key={option.value}
                  className={`cursor-pointer transition-all hover:shadow-lg border-2 relative overflow-hidden ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-lg'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => onValueChange(option.value)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onValueChange(option.value);
                    }
                  }}
                >
                  <div className="p-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <RadioGroupItem
                          value={option.value}
                          id={`${id}-${option.value}`}
                          className="text-blue-600"
                        />
                        <div className={`flex items-center ${colorClass}`}>
                          {icon}
                          <Label
                            htmlFor={`${id}-${option.value}`}
                            className="font-medium cursor-pointer leading-tight ml-2"
                          >
                            {option.label}
                          </Label>
                        </div>
                      </div>
                      {isSelected && (
                        <div className="bg-primary text-primary-foreground rounded-full p-1">
                          <Check className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            }

            if (viewMode === 'compact') {
              return (
                <Card
                  key={option.value}
                  className={`cursor-pointer transition-all hover:shadow-lg border-2 relative p-3 overflow-hidden ${
                    isSelected
                      ? 'border-primary bg-primary/5 shadow-lg'
                      : 'border-border hover:border-primary/50'
                  }`}
                  onClick={() => onValueChange(option.value)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      onValueChange(option.value);
                    }
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <RadioGroupItem
                        value={option.value}
                        id={`${id}-${option.value}`}
                        className="text-blue-600"
                      />
                      <div className={`flex items-center ${colorClass}`}>
                        {compactIcon}
                        <Label
                          htmlFor={`${id}-${option.value}`}
                          className="font-medium cursor-pointer leading-tight ml-2"
                        >
                          {option.label}
                        </Label>
                      </div>
                    </div>
                    {isSelected && (
                      <div className="bg-primary text-primary-foreground rounded-full p-1">
                        <Check className="w-3 h-3" />
                      </div>
                    )}
                  </div>
                </Card>
              );
            }

            // Default: Grid view
            return (
              <Card
                key={option.value}
                className={`group cursor-pointer transition-all hover:shadow-xl border-2 relative overflow-hidden aspect-square ${
                  isSelected
                    ? 'border-primary shadow-lg'
                    : 'border-border/30 hover:border-infinite-purple/50'
                }`}
                onClick={() => onValueChange(option.value)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onValueChange(option.value);
                  }
                }}
              >
                <div
                  className="absolute inset-0"
                  style={{ boxShadow: 'inset 0 0 60px 20px rgba(0,0,0,0.08)' }}
                />
                {isSelected && (
                  <div
                    className="absolute top-3 right-3 bg-primary text-primary-foreground rounded-full p-1"
                    style={{ zIndex: Z_INDEX.CARD_HOVER }}
                  >
                    <Check className="w-4 h-4" />
                  </div>
                )}
                <div
                  className="absolute bottom-3 left-3 flex items-center gap-2"
                  style={{ zIndex: Z_INDEX.DROPDOWN }}
                >
                  {icon}
                  <span className="font-bold text-lg">{option.label}</span>
                </div>
              </Card>
            );
          })}
      </RadioGroup>
    </div>
  );
};

export default CampaignParameterSection;
