import React from 'react';

import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

interface SettingSwitchProps {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * One on/off row. The switch is 44 px tall so the whole row is a usable tap target.
 * Under the Table look the track and knob follow the Panels board: 46x26 track
 * (#8a6a30 on / #1c2742 off), 20px #f3deb0 knob at 23px on / 3px off (#1429).
 */
export const SettingSwitch: React.FC<SettingSwitchProps> = ({
  id,
  label,
  description,
  checked,
  onChange,
}) => (
  <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-card p-4 min-h-11 [body.ir-table-look_&]:!min-h-[60px]">
    <div className="flex-1 space-y-1">
      <Label
        htmlFor={id}
        className="cursor-pointer text-base font-medium [body.ir-table-look_&]:font-bold"
      >
        {label}
      </Label>
      <p className="text-sm leading-relaxed text-muted-foreground [body.ir-table-look_&]:!text-[#aab3cc]">
        {description}
      </p>
    </div>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-8 w-14 flex-shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        checked ? 'bg-infinite-gold' : 'bg-muted',
        checked
          ? '[body.ir-table-look_&]:!h-[26px] [body.ir-table-look_&]:!w-[46px] [body.ir-table-look_&]:!bg-[#8a6a30]'
          : '[body.ir-table-look_&]:!h-[26px] [body.ir-table-look_&]:!w-[46px] [body.ir-table-look_&]:!bg-[#1c2742]',
      )}
    >
      <span
        className={cn(
          'inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform',
          checked ? 'translate-x-7' : 'translate-x-1',
          checked
            ? '[body.ir-table-look_&]:!h-5 [body.ir-table-look_&]:!w-5 [body.ir-table-look_&]:!translate-x-[23px] [body.ir-table-look_&]:!bg-[#f3deb0]'
            : '[body.ir-table-look_&]:!h-5 [body.ir-table-look_&]:!w-5 [body.ir-table-look_&]:!translate-x-[3px] [body.ir-table-look_&]:!bg-[#f3deb0]',
        )}
      />
    </button>
  </div>
);
