import React, { useState } from 'react';

import type { QuickAction } from './hooks/use-quick-action-menu';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Z_INDEX } from '@/constants/z-index';
import { cn } from '@/lib/utils';

/**
 * Calculate position for radial menu items
 */
export function calculateRadialPosition(
  index: number,
  total: number,
  radius: number,
  offsetAngle: number = -90,
): { x: number; y: number; angle: number } {
  const angleStep = 360 / total;
  const angle = offsetAngle + angleStep * index;
  const radian = (angle * Math.PI) / 180;

  return {
    x: Math.cos(radian) * radius,
    y: Math.sin(radian) * radius,
    angle,
  };
}

interface RadialActionButtonProps {
  action: QuickAction;
  position: { x: number; y: number; angle: number };
  index: number;
  onTrigger: () => void;
}

export const RadialActionButton: React.FC<RadialActionButtonProps> = ({
  action,
  position,
  index,
  onTrigger,
}) => {
  const Icon = action.icon;
  const [isInteracting, setIsInteracting] = useState(false);

  const variantColors = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/90',
    danger: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
    success: 'bg-green-600 text-white hover:bg-green-700',
    warning: 'bg-yellow-600 text-white hover:bg-yellow-700',
  };

  const color = variantColors[action.variant || 'default'];

  return (
    <Tooltip delayDuration={300}>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onTrigger}
          onMouseEnter={() => setIsInteracting(true)}
          onMouseLeave={() => setIsInteracting(false)}
          onFocus={() => setIsInteracting(true)}
          onBlur={() => setIsInteracting(false)}
          disabled={action.enabled === false}
          className={cn(
            'absolute flex flex-col items-center justify-center gap-1 p-3 rounded-lg transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple focus-visible:ring-offset-2',
            'shadow-lg border-2 border-background',
            action.enabled === false && 'opacity-40 cursor-not-allowed',
            action.enabled !== false && color,
            isInteracting && 'scale-110',
          )}
          style={{
            left: `calc(50% + ${position.x}px)`,
            top: `calc(50% + ${position.y}px)`,
            transform: 'translate(-50%, -50%)',
            zIndex: isInteracting ? Z_INDEX.DROPDOWN : undefined,
            animation: `radialAppear 0.3s ease-out ${index * 0.05}s both`,
          }}
          aria-label={action.shortcut ? `${action.label} (${action.shortcut})` : action.label}
        >
          <Icon className="h-5 w-5" aria-hidden="true" />
          <span className="text-xs font-medium whitespace-nowrap">{action.label}</span>
          {action.shortcut && (
            <span className="text-[10px] font-mono opacity-75">{action.shortcut}</span>
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p>{action.description || action.label}</p>
      </TooltipContent>
    </Tooltip>
  );
};
