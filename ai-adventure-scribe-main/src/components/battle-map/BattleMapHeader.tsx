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
    <div
      className="absolute top-0 left-0 right-0 h-14 bg-background/95 backdrop-blur-sm border-b flex items-center justify-between px-4"
      style={{ zIndex: Z_INDEX.FLOATING_PANEL }}
    >
      {/* Breadcrumbs */}
      <nav
        className="flex items-center gap-2 text-sm text-muted-foreground"
        aria-label="Breadcrumb"
      >
        <button
          type="button"
          onClick={() => navigate('/app/campaigns')}
          className="hover:text-foreground transition-colors focus-visible:text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ring-offset-2 rounded-sm"
          aria-label="Back to Campaigns"
          title="Back to Campaigns"
        >
          Campaigns
        </button>
        <span aria-hidden="true">/</span>
        <button
          type="button"
          onClick={onBackToCampaign}
          className="hover:text-foreground transition-colors max-w-[150px] truncate focus-visible:text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ring-offset-2 rounded-sm"
          aria-label={campaignName ? `Back to ${campaignName}` : 'Back to Campaign'}
          title={campaignName ? `Back to ${campaignName}` : 'Back to Campaign'}
        >
          {campaignName || 'Campaign'}
        </button>
        <span aria-hidden="true">/</span>
        <button
          type="button"
          onClick={onBackToScenes}
          className="hover:text-foreground transition-colors focus-visible:text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring ring-offset-2 rounded-sm"
          aria-label="Back to Scenes"
          title="Back to Scenes"
        >
          Scenes
        </button>
        <span aria-hidden="true">/</span>
        <span
          className="text-foreground font-medium max-w-[200px] truncate"
          aria-current="page"
        >
          {sceneName}
        </span>
      </nav>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Mobile: Layers Panel Toggle */}
        {isMobile && (
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleLayersPanel}
            aria-label={showLayersPanel ? 'Hide Layers' : 'Show Layers'}
            aria-pressed={showLayersPanel}
            aria-expanded={showLayersPanel}
            title={showLayersPanel ? 'Hide Layers' : 'Show Layers'}
          >
            <Layers className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}

        {/* Settings Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open Settings" title="Open Settings">
              <SettingsIcon className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
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
            <DropdownMenuCheckboxItem checked={showLayersPanel} onCheckedChange={toggleLayersPanel}>
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
  );
};
