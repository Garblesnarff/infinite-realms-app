import React from 'react';

import { MapUploader } from '../MapUploader';

interface StepBackgroundImageProps {
  campaignId: string;
  width: number;
  height: number;
  gridSize: number;
  backgroundImageUrl: string;
  onUpdate: (updates: { backgroundImageUrl: string; thumbnailUrl: string }) => void;
}

export const StepBackgroundImage: React.FC<StepBackgroundImageProps> = ({
  campaignId,
  width,
  height,
  gridSize,
  backgroundImageUrl,
  onUpdate,
}) => {
  return (
    <div className="space-y-6">
      <MapUploader
        campaignId={campaignId}
        width={width}
        height={height}
        gridSize={gridSize}
        onImageUpload={(url, thumbnailUrl) => {
          onUpdate({
            backgroundImageUrl: url,
            thumbnailUrl: thumbnailUrl || url,
          });
        }}
      />

      {backgroundImageUrl && (
        <div className="bg-muted/50 p-4 rounded-lg">
          <p className="text-sm font-medium mb-2">Image Uploaded</p>
          <p className="text-xs text-muted-foreground break-all">
            {backgroundImageUrl}
          </p>
        </div>
      )}
    </div>
  );
};
