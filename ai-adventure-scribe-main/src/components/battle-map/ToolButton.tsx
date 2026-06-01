import React from 'react';

import type { ToolConfig } from './toolbar-config';

import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export interface ToolButtonProps {
  tool: ToolConfig;
  isActive: boolean;
  onClick: () => void;
  orientation: 'horizontal' | 'vertical';
}

export const ToolButton: React.FC<ToolButtonProps> = ({ tool, isActive, onClick, orientation }) => {
  const Icon = tool.icon;

  return (
    <TooltipProvider>
      <Tooltip delayDuration={300}>
        <TooltipTrigger asChild>
          <Button
            variant={isActive ? 'default' : 'ghost'}
            size="icon"
            onClick={onClick}
            className={cn(
              'relative',
              isActive && 'bg-primary text-primary-foreground',
              !isActive && 'hover:bg-accent hover:text-accent-foreground',
            )}
            aria-label={`${tool.label} (${tool.shortcut})`}
            aria-pressed={isActive}
          >
            <Icon className="h-5 w-5" aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side={orientation === 'vertical' ? 'right' : 'bottom'}>
          <div className="flex flex-col gap-1">
            <span className="font-medium">{tool.label}</span>
            <span className="text-xs text-muted-foreground">{tool.description}</span>
            <span className="text-xs font-mono bg-muted px-1 rounded self-start">
              {tool.shortcut}
            </span>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
