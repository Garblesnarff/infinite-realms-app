import React from 'react';
import { Eye, EyeOff, Scroll, Info } from 'lucide-react';

import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { useLocalStorage } from '@/hooks/use-local-storage';
import { cn } from '@/lib/utils';

const CampaignSettings: React.FC = () => {
  const [showNPCRolls, setShowNPCRolls] = useLocalStorage('game:showNPCRolls', true);

  return (
    <div className="mt-4 space-y-4">
      {/* Combat & Gameplay Settings */}
      <Card className="p-6">
        <div className="mb-6">
          <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
            <Scroll className="w-5 h-5" />
            Combat & Gameplay
          </h2>
          <p className="text-muted-foreground text-sm">
            Configure how combat and dice rolls are displayed during gameplay.
          </p>
        </div>

        <div className="space-y-6">
          {/* Show NPC Rolls Toggle */}
          <div className="flex items-start justify-between gap-4 p-4 rounded-lg border border-border/50 bg-card/50 hover:border-border transition-colors">
            <div className="flex-1 space-y-2">
              <Label
                htmlFor="show-npc-rolls"
                className="text-base font-medium cursor-pointer flex items-center gap-2"
              >
                {showNPCRolls ? (
                  <Eye className="w-4 h-4 text-primary" />
                ) : (
                  <EyeOff className="w-4 h-4 text-muted-foreground" />
                )}
                Show NPC Rolls
              </Label>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Display "Behind the DM Screen" popups when NPCs and enemies make dice rolls. See
                attack rolls, damage, and saving throws as they happen.
              </p>

              {/* Info box */}
              <div className="flex items-start gap-2 mt-3 p-3 rounded-md bg-muted/50 border border-border/30">
                <Info className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Tabletop Note:</strong> In traditional D&D,
                  the DM rolls behind a screen. Enable this for more transparency and excitement, or
                  disable for a more mysterious, narrative-focused experience.
                </p>
              </div>
            </div>

            {/* Toggle Switch */}
            <div className="flex items-center">
              <button
                id="show-npc-rolls"
                role="switch"
                aria-checked={showNPCRolls}
                onClick={() => setShowNPCRolls(!showNPCRolls)}
                className={cn(
                  'relative inline-flex h-8 w-14 items-center rounded-full transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  showNPCRolls ? 'bg-primary' : 'bg-muted'
                )}
              >
                <span
                  className={cn(
                    'inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform',
                    showNPCRolls ? 'translate-x-7' : 'translate-x-1'
                  )}
                />
              </button>
            </div>
          </div>

          {/* Preview/Status */}
          {showNPCRolls && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground pl-4">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span>NPC roll popups are enabled</span>
            </div>
          )}
        </div>
      </Card>

      {/* Future settings sections can go here */}
      <Card className="p-6 bg-muted/20">
        <h3 className="text-lg font-semibold mb-2 text-muted-foreground">More Settings Coming Soon</h3>
        <p className="text-sm text-muted-foreground">
          Additional campaign and gameplay settings will be added here in future updates.
        </p>
      </Card>
    </div>
  );
};

export default CampaignSettings;
