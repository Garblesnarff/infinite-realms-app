import { ArrowLeft, Settings as SettingsIcon, Layers } from 'lucide-react';
import React from 'react';
import { useNavigate } from 'react-router-dom';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Z_INDEX } from '@/constants/z-index';

interface BattleMapHeaderProps {
  campaignName?: string;
  sceneName: string;
  isMobile: boolean;
  showLayersPanel: boolean;
  toggleLayersPanel: () => void;
  showPerformanceMonitor: boolean;
  setShowPerformanceMonitor: (show: boolean) => void;
  setShowHotkeyGuide: (show: boolean) => void;
  onBackToScenes: () => void;
  onBackToCampaign: () => void;
}

/**
 * Battle Map Header Component
 *
 * Extracted from BattleMapPage to handle navigation, breadcrumbs, and view settings.
 */
export const BattleMapHeader: React.FC<BattleMapHeaderProps> = ({
  campaignName,
  sceneName,
  isMobile,
  showLayersPanel,
  toggleLayersPanel,
  showPerformanceMonitor,
  setShowPerformanceMonitor,
  setShowHotkeyGuide,
  onBackToScenes,
  onBackToCampaign,
}) => {
  const navigate = useNavigate();

  return (
    <TooltipProvider>
      <div
        className="absolute top-0 left-0 right-0 h-14 bg-background/95 backdrop-blur-sm border-b flex items-center justify-between px-4"
        style={{ zIndex: Z_INDEX.FLOATING_PANEL }}
      >
        {/* Breadcrumbs */}
        <nav
          className="flex items-center gap-2 text-sm text-muted-foreground"
          aria-label="Breadcrumb"
        >
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => navigate('/app')}
                className="hover:text-foreground transition-colors focus-visible:text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ring-offset-2 rounded-sm"
                aria-label="Back to Campaigns"
              >
                Campaigns
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Back to Campaigns</p>
            </TooltipContent>
          </Tooltip>

          <span aria-hidden="true">/</span>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onBackToCampaign}
                className="hover:text-foreground transition-colors max-w-[150px] truncate focus-visible:text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ring-offset-2 rounded-sm"
                aria-label={campaignName ? `Back to ${campaignName}` : 'Back to Campaign'}
              >
                {campaignName || 'Campaign'}
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{campaignName ? `Back to ${campaignName}` : 'Back to Campaign'}</p>
            </TooltipContent>
          </Tooltip>

          <span aria-hidden="true">/</span>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onBackToScenes}
                className="hover:text-foreground transition-colors focus-visible:text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ring-offset-2 rounded-sm"
                aria-label="Back to Scenes"
              >
                Scenes
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Back to Scenes</p>
            </TooltipContent>
          </Tooltip>

          <span aria-hidden="true">/</span>

          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <span
                className="text-foreground font-medium max-w-[200px] truncate cursor-default outline-none focus-visible:ring-2 focus-visible:ring-infinite-purple rounded-sm"
                aria-current="page"
                tabIndex={0}
              >
                {sceneName}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>{sceneName}</p>
            </TooltipContent>
          </Tooltip>
        </nav>

        {/* Actions */}
        <div className="flex items-center gap-2">
          {/* Mobile: Layers Panel Toggle */}
          {isMobile && (
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  type="button"
                  onClick={toggleLayersPanel}
                  aria-label={showLayersPanel ? 'Hide Layers' : 'Show Layers'}
                  aria-pressed={showLayersPanel}
                  aria-expanded={showLayersPanel}
                >
                  <Layers className="h-4 w-4" aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{showLayersPanel ? 'Hide Layers' : 'Show Layers'}</p>
              </TooltipContent>
            </Tooltip>
          )}

          {/* Settings Dropdown */}
          <DropdownMenu>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label="Open View Settings" type="button">
                    <SettingsIcon className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent align="end">
                <p>Open View Settings</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>View Settings</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={showPerformanceMonitor}
                onCheckedChange={() => setShowPerformanceMonitor(!showPerformanceMonitor)}
              >
                Performance Monitor
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onClick={() => setShowHotkeyGuide(true)}>
                Keyboard Shortcuts
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={showLayersPanel}
                onCheckedChange={toggleLayersPanel}
              >
                Layers Panel
              </DropdownMenuCheckboxItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onBackToScenes}>
                <ArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
                Back to Scenes
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </TooltipProvider>
  );
};
