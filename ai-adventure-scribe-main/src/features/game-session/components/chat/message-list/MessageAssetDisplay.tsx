/**
 * MessageAssetDisplay Component
 *
 * Displays campaign assets (character portraits, NPC images, locations, etc.)
 * that are referenced in an AI message. Shows as a horizontal gallery
 * below the message content with click-to-expand functionality.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import React from 'react';

import {
  AssetCard,
  GeneratedImageCard,
  GenerateButtonCard,
  getAssetIcon,
  getAssetGradient,
} from './MessageAssetCards';

import type { AssetTag } from '../../utils/parse-asset-tags';
import type { CampaignAsset } from '@/hooks/use-campaign-assets';

import { Z_INDEX } from '@/constants/z-index';
import { cn } from '@/lib/utils';

interface GeneratedImageData {
  url?: string;
  isGenerating?: boolean;
  error?: string;
  onGenerate?: () => void;
}

interface MessageAssetDisplayProps {
  /** Asset tags parsed from the message */
  assetTags: AssetTag[];
  /** Function to look up asset by type and key */
  getAsset: (type: string, key: string) => CampaignAsset | null;
  /** Optional className */
  className?: string;
  /** Optional generated image to display alongside campaign assets */
  generatedImage?: GeneratedImageData;
}

/**
 * MessageAssetDisplay Component
 */
export const MessageAssetDisplay: React.FC<MessageAssetDisplayProps> = ({
  assetTags,
  getAsset,
  className,
  generatedImage,
}) => {
  const [expandedAsset, setExpandedAsset] = React.useState<CampaignAsset | null>(null);
  const [expandedGenerated, setExpandedGenerated] = React.useState(false);

  // Resolve asset tags to actual assets (filter out those without images)
  const resolvedAssets = React.useMemo(() => {
    const assets: CampaignAsset[] = [];

    for (const tag of assetTags) {
      const asset = getAsset(tag.type, tag.key);
      if (asset && asset.imageUrl) {
        assets.push(asset);
      }
    }

    return assets;
  }, [assetTags, getAsset]);

  // Check if we have anything to show
  const hasAssets = resolvedAssets.length > 0;
  const hasGeneratedImage = Boolean(generatedImage?.url);
  const hasGenerateButton = Boolean(generatedImage?.onGenerate);

  // Don't render if nothing to show
  if (!hasAssets && !hasGeneratedImage && !hasGenerateButton) {
    return null;
  }

  return (
    <>
      <div className={cn('flex flex-wrap gap-3 mt-4', className)}>
        {/* Campaign assets */}
        {resolvedAssets.map((asset) => (
          <AssetCard
            key={`${asset.type}:${asset.key}`}
            asset={asset}
            onClick={() => setExpandedAsset(asset)}
          />
        ))}
        {/* Generated image card */}
        {hasGeneratedImage && (
          <GeneratedImageCard
            url={generatedImage!.url!}
            onClick={() => setExpandedGenerated(true)}
          />
        )}
        {/* Generate button (when no image yet) */}
        {!hasGeneratedImage && hasGenerateButton && (
          <GenerateButtonCard
            isGenerating={generatedImage?.isGenerating}
            error={generatedImage?.error}
            onGenerate={generatedImage!.onGenerate!}
          />
        )}
      </div>

      {/* Expanded asset view modal - uses high z-index to appear above all game UI */}
      <DialogPrimitive.Root
        open={!!expandedAsset}
        onOpenChange={(open) => !open && setExpandedAsset(null)}
      >
        <DialogPrimitive.Portal>
          {/* Overlay with very high z-index */}
          <DialogPrimitive.Overlay
            className="fixed inset-0 bg-black/90 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            style={{ zIndex: Z_INDEX.IMAGE_LIGHTBOX_BACKDROP }}
          />
          {/* Content with very high z-index */}
          <DialogPrimitive.Content
            className="fixed left-[50%] top-[50%] -translate-x-1/2 -translate-y-1/2 max-w-2xl w-[95vw] p-0 overflow-hidden bg-black/95 border border-white/10 rounded-lg shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            style={{ zIndex: Z_INDEX.IMAGE_LIGHTBOX }}
          >
            {/* Screen reader accessible title */}
            <DialogPrimitive.Title className="sr-only">
              {expandedAsset?.name || 'Asset'} preview
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Enlarged view of the {expandedAsset?.type} asset.
            </DialogPrimitive.Description>
            {expandedAsset && (
              <div className="relative">
                {/* Close button */}
                <DialogPrimitive.Close
                  className="absolute top-3 right-3 p-2 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors"
                  style={{ zIndex: Z_INDEX.POPOVER }}
                  aria-label={`Close ${expandedAsset.name} preview`}
                  title={`Close ${expandedAsset.name} preview`}
                >
                  <X className="h-5 w-5" />
                </DialogPrimitive.Close>

                {/* Full-size image */}
                <div className="relative aspect-square md:aspect-[4/3] w-full">
                  <img
                    src={expandedAsset.imageUrl || ''}
                    alt={expandedAsset.name}
                    className="w-full h-full object-contain"
                  />
                </div>

                {/* Asset info */}
                <div
                  className={cn(
                    'p-4 bg-gradient-to-t border-t',
                    getAssetGradient(expandedAsset.type),
                  )}
                >
                  <h3 className="text-lg font-semibold text-white">{expandedAsset.name}</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {getAssetIcon(expandedAsset.type)}
                    <span className="text-sm text-white/70 uppercase tracking-wider">
                      {expandedAsset.type}
                    </span>
                  </div>
                  {expandedAsset.description && (
                    <p className="mt-2 text-sm text-white/60">{expandedAsset.description}</p>
                  )}
                </div>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>

      {/* Expanded generated image modal */}
      <DialogPrimitive.Root open={expandedGenerated} onOpenChange={setExpandedGenerated}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            className="fixed inset-0 bg-black/90 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
            style={{ zIndex: Z_INDEX.IMAGE_LIGHTBOX_BACKDROP }}
          />
          <DialogPrimitive.Content
            className="fixed left-[50%] top-[50%] -translate-x-1/2 -translate-y-1/2 max-w-2xl w-[95vw] p-0 overflow-hidden bg-black/95 border border-white/10 rounded-lg shadow-xl focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            style={{ zIndex: Z_INDEX.IMAGE_LIGHTBOX }}
          >
            <DialogPrimitive.Title className="sr-only">
              Generated scene preview
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Enlarged view of the AI-generated scene.
            </DialogPrimitive.Description>
            {generatedImage?.url && (
              <div className="relative">
                <DialogPrimitive.Close
                  className="absolute top-3 right-3 p-2 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors"
                  style={{ zIndex: Z_INDEX.POPOVER }}
                  aria-label="Close generated scene preview"
                  title="Close generated scene preview"
                >
                  <X className="h-5 w-5" />
                </DialogPrimitive.Close>
                <div className="relative aspect-square md:aspect-[4/3] w-full">
                  <img
                    src={generatedImage.url}
                    alt="Generated scene"
                    className="w-full h-full object-contain"
                  />
                </div>
                <div className={cn('p-4 bg-gradient-to-t border-t', getAssetGradient('generated'))}>
                  <h3 className="text-lg font-semibold text-white">Generated Scene</h3>
                  <div className="flex items-center gap-2 mt-1">
                    {getAssetIcon('generated')}
                    <span className="text-sm text-white/70 uppercase tracking-wider">
                      AI Generated
                    </span>
                  </div>
                </div>
              </div>
            )}
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
};

export default MessageAssetDisplay;
