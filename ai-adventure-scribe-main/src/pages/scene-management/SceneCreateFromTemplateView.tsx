import { ArrowLeft, Plus } from 'lucide-react';
import React from 'react';

import type { SceneTemplate } from '@/components/scenes/scene-templates';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

interface SceneCreateFromTemplateViewProps {
  selectedTemplate: SceneTemplate;
  isCreating: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export const SceneCreateFromTemplateView: React.FC<SceneCreateFromTemplateViewProps> = ({
  selectedTemplate,
  isCreating,
  onCancel,
  onConfirm,
}) => (
  <div>
    <div className="mb-6 flex items-center justify-between">
      <div>
        <h2 className="text-2xl font-bold">Create from Template</h2>
        <p className="text-muted-foreground">
          Creating scene based on: <strong>{selectedTemplate.name}</strong>
        </p>
      </div>
      <Button onClick={onCancel} variant="outline">
        <ArrowLeft className="mr-2 h-4 w-4" />
        Back to List
      </Button>
    </div>

    <Card className="max-w-2xl mx-auto">
      <CardHeader>
        <div className="text-6xl mb-4 text-center">{selectedTemplate.thumbnailEmoji}</div>
        <CardTitle className="text-center">{selectedTemplate.name}</CardTitle>
        <CardDescription className="text-center">{selectedTemplate.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="text-center p-4 bg-white/[0.05] rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Dimensions</p>
            <p className="font-semibold">
              {selectedTemplate.width} × {selectedTemplate.height} squares
            </p>
          </div>
          <div className="text-center p-4 bg-white/[0.05] rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Grid Type</p>
            <p className="font-semibold capitalize">
              {selectedTemplate.gridType.replace('_', ' ')}
            </p>
          </div>
          <div className="text-center p-4 bg-white/[0.05] rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Lighting</p>
            <p className="font-semibold">
              {Math.round(parseFloat(selectedTemplate.suggestedSettings.ambientLightLevel) * 100)}%
            </p>
          </div>
          <div className="text-center p-4 bg-white/[0.05] rounded-lg">
            <p className="text-sm text-muted-foreground mb-1">Time of Day</p>
            <p className="font-semibold capitalize">
              {selectedTemplate.suggestedSettings.timeOfDay}
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="font-semibold">Included Features:</h4>
          <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
            <li>Pre-configured dimensions and grid</li>
            <li>Optimized lighting settings</li>
            {selectedTemplate.suggestedSettings.enableFogOfWar && <li>Fog of War enabled</li>}
            {selectedTemplate.suggestedSettings.enableDynamicLighting && (
              <li>Dynamic lighting enabled</li>
            )}
          </ul>
        </div>

        <div className="bg-infinite-gold/10 border border-infinite-gold/30 rounded-lg p-4">
          <p className="text-sm text-infinite-gold">
            <strong>Note:</strong> You'll need to upload your own background image after creating
            the scene.
          </p>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={onCancel} className="flex-1">
            Cancel
          </Button>
          <Button variant="cosmic" onClick={onConfirm} disabled={isCreating} className="flex-1">
            {isCreating ? (
              'Creating...'
            ) : (
              <>
                <Plus className="mr-2 h-4 w-4" />
                Create Scene
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  </div>
);
