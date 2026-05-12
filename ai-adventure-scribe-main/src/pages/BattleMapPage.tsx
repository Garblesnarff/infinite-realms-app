/**
 * Battle Map Page
 *
 * Main page for viewing and interacting with battle maps.
 * Provides a full-screen canvas with toolbar, layers panel, and tool options.
 *
 * Features:
 * - Full-screen battle canvas
 * - Vertical toolbar with tool selection
 * - Collapsible layers panel
 * - Tool options panel
 * - Breadcrumb navigation
 * - Settings and performance monitor
 * - Keyboard shortcuts
 * - Responsive design (mobile/desktop)
 */

import { ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

import { BattleCanvas } from '@/components/battle-map/BattleCanvas';
import { BattleMapError } from '@/components/battle-map/BattleMapError';
import { BattleMapHeader } from '@/components/battle-map/BattleMapHeader';
import { BattleMapLoading } from '@/components/battle-map/BattleMapLoading';
import { HotkeyGuide } from '@/components/battle-map/HotkeyGuide';
import { LayersPanel } from '@/components/battle-map/LayersPanel';
import { PerformanceMonitor } from '@/components/battle-map/PerformanceMonitor';
import { QuickActionMenu } from '@/components/battle-map/QuickActionMenu';
import { Toolbar } from '@/components/battle-map/Toolbar';
import { ToolOptionsPanel } from '@/components/battle-map/ToolOptionsPanel';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Z_INDEX } from '@/constants/z-index';
import { useAuth } from '@/contexts/AuthContext';
import { useHotkeys, BATTLE_MAP_HOTKEYS, createHotkeyFromPreset } from '@/hooks/use-hotkeys';
import { trpc } from '@/infrastructure/api/trpc-client';
import logger from '@/lib/logger';
import { cn } from '@/lib/utils';
import { useBattleMapStore } from '@/stores/useBattleMapStore';

/**
 * Battle Map Page Component
 */
export const BattleMapPage: React.FC = () => {
  const { sceneId, campaignId } = useParams<{ sceneId: string; campaignId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  // State
  const [showLayersPanel, setShowLayersPanel] = useState(true);
  const [showPerformanceMonitor, setShowPerformanceMonitor] = useState(false);
  const [showHotkeyGuide, setShowHotkeyGuide] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Battle map store
  const setActiveSceneId = useBattleMapStore((state) => state.setActiveSceneId);
  const clearSelection = useBattleMapStore((state) => state.clearSelection);
  const selectedTool = useBattleMapStore((state) => state.selectedTool);

  // Fetch scene data
  const {
    data: scene,
    isLoading: isLoadingScene,
    error: sceneError,
  } = trpc.scenes.getById.useQuery(
    { sceneId: sceneId! },
    {
      enabled: !!sceneId,
      retry: 1,
      onSuccess: (data) => {
        logger.info('Scene loaded successfully', { sceneId: data.id, name: data.name });
      },
      onError: (error) => {
        logger.error('Failed to load scene', { sceneId, error });
      },
    },
  );

  // Fetch campaign data for breadcrumbs
  const { data: campaign } = trpc.campaigns.getById.useQuery(
    { campaignId: campaignId! },
    { enabled: !!campaignId },
  );

  const isGM = Boolean(
    user &&
    ((scene as any)?.userId === user.id ||
      (scene as any)?.user_id === user.id ||
      (campaign as any)?.userId === user.id ||
      (campaign as any)?.user_id === user.id),
  );

  // ===========================
  // Effects
  // ===========================

  // Set active scene in store
  useEffect(() => {
    if (sceneId) {
      setActiveSceneId(sceneId);
    }
    return () => {
      setActiveSceneId(null);
    };
  }, [sceneId, setActiveSceneId]);

  // Detect mobile viewport
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);

    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // Hide panels on mobile by default
  useEffect(() => {
    if (isMobile) {
      setShowLayersPanel(false);
    } else {
      setShowLayersPanel(true);
    }
  }, [isMobile]);

  // ===========================
  // Keyboard Shortcuts
  // ===========================

  useHotkeys({
    hotkeys: [
      createHotkeyFromPreset(BATTLE_MAP_HOTKEYS.CANCEL, () => {
        clearSelection();
      }),
      createHotkeyFromPreset(BATTLE_MAP_HOTKEYS.HELP, () => {
        setShowHotkeyGuide(true);
      }),
      createHotkeyFromPreset(BATTLE_MAP_HOTKEYS.TOGGLE_GRID, () => {
        // Grid toggle handled by layers panel
      }),
    ],
    enabled: true,
  });

  // ===========================
  // Handlers
  // ===========================

  const handleBackToScenes = () => {
    navigate(`/app/campaigns/${campaignId}/scenes`);
  };

  const handleBackToCampaign = () => {
    navigate(`/app/campaigns/${campaignId}`);
  };

  const handleHelpClick = () => {
    setShowHotkeyGuide(true);
  };

  const handleSettingsClick = () => {
    // Settings logic could be expanded here
    setShowPerformanceMonitor(!showPerformanceMonitor);
  };

  const toggleLayersPanel = () => {
    setShowLayersPanel(!showLayersPanel);
  };

  // ===========================
  // Validation
  // ===========================

  if (!sceneId || !campaignId) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Invalid Route</CardTitle>
            <CardDescription>Scene ID or Campaign ID is missing.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => navigate('/app')} className="w-full">
              Return to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ===========================
  // Loading State
  // ===========================

  if (isLoadingScene) {
    return <BattleMapLoading />;
  }

  // ===========================
  // Error State
  // ===========================

  if (sceneError || !scene) {
    return (
      <BattleMapError
        message={sceneError?.message}
        onBackToScenes={handleBackToScenes}
        onBackToCampaign={handleBackToCampaign}
      />
    );
  }

  // ===========================
  // Main Render
  // ===========================

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background">
      {/* Top Navigation Bar */}
      <BattleMapHeader
        campaignName={campaign?.name}
        sceneName={scene.name}
        isMobile={isMobile}
        showLayersPanel={showLayersPanel}
        toggleLayersPanel={toggleLayersPanel}
        showPerformanceMonitor={showPerformanceMonitor}
        setShowPerformanceMonitor={setShowPerformanceMonitor}
        setShowHotkeyGuide={setShowHotkeyGuide}
        onBackToScenes={handleBackToScenes}
        onBackToCampaign={handleBackToCampaign}
      />

      {/* Main Content Area */}
      <div className="absolute top-14 left-0 right-0 bottom-0 flex">
        {/* Battle Canvas - Full screen background */}
        <div className="flex-1 relative">
          <BattleCanvas
            sceneId={sceneId}
            backgroundColor="#1a1a2e"
            enablePan={selectedTool === 'pan'}
            enableZoom={true}
            minZoom={0.25}
            maxZoom={8}
            className="w-full h-full"
          />

          {/* Toolbar - Positioned on left side */}
          <Toolbar
            sceneId={sceneId}
            isGM={isGM}
            orientation="vertical"
            position="left"
            showHelp={true}
            onHelpClick={handleHelpClick}
            onSettingsClick={handleSettingsClick}
          />

          {/* Tool Options Panel - Positioned below toolbar when active */}
          {(selectedTool === 'wall' || selectedTool === 'fog-brush' || selectedTool === 'draw') && (
            <div className="absolute left-4 bottom-4" style={{ zIndex: Z_INDEX.FLOATING_PANEL }}>
              <ToolOptionsPanel sceneId={sceneId} />
            </div>
          )}

          {/* Performance Monitor - Top left corner */}
          {showPerformanceMonitor && (
            <div className="absolute top-4 left-20" style={{ zIndex: Z_INDEX.FLOATING_PANEL }}>
              <PerformanceMonitor />
            </div>
          )}

          {/* Layers Panel Toggle (Desktop) */}
          {!isMobile && (
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleLayersPanel}
              aria-label={showLayersPanel ? 'Hide Layers' : 'Show Layers'}
              aria-pressed={showLayersPanel}
              aria-expanded={showLayersPanel}
              title={showLayersPanel ? 'Hide Layers' : 'Show Layers'}
              className={cn(
                'absolute top-4 transition-all',
                showLayersPanel ? 'right-80' : 'right-4',
              )}
              style={{ zIndex: Z_INDEX.FLOATING_PANEL }}
            >
              {showLayersPanel ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <ChevronLeft className="h-4 w-4" />
              )}
            </Button>
          )}
        </div>

        {/* Layers Panel - Right side (Desktop) or Sheet (Mobile) */}
        {isMobile ? (
          <Sheet open={showLayersPanel} onOpenChange={setShowLayersPanel}>
            <SheetContent side="right" className="w-80 p-0">
              <SheetHeader className="p-4 border-b">
                <SheetTitle>Layers</SheetTitle>
              </SheetHeader>
              <div className="overflow-y-auto h-[calc(100vh-5rem)]">
                <LayersPanel sceneId={sceneId} side="right" />
              </div>
            </SheetContent>
          </Sheet>
        ) : (
          showLayersPanel && (
            <div className="w-80 border-l bg-background/95 backdrop-blur-sm overflow-y-auto">
              <LayersPanel sceneId={sceneId} side="right" />
            </div>
          )
        )}
      </div>

      {/* Quick Action Menu - Activated by 'Q' key */}
      <QuickActionMenu sceneId={sceneId} />

      {/* Hotkey Guide Modal */}
      {showHotkeyGuide && <HotkeyGuide open={showHotkeyGuide} onOpenChange={setShowHotkeyGuide} />}
    </div>
  );
};

export default BattleMapPage;
