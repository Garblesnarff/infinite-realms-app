import React from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface ColorPickerProps {
  label: string;
  value: string;
  onChange: (color: string) => void;
  className?: string;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({ label, value, onChange, className }) => {
  const id = React.useId();
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Label htmlFor={id} className="text-sm flex-shrink-0">
        {label}
      </Label>
      <div className="flex items-center gap-2 flex-1">
        <input
          id={id}
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-10 h-8 rounded border cursor-pointer"
        />
        <span className="text-xs text-muted-foreground font-mono">{value}</span>
      </div>
    </div>
  );
};
