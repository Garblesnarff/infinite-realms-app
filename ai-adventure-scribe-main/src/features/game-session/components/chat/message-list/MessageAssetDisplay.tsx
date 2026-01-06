/**
 * MessageAssetDisplay Component
 *
 * Displays campaign assets (character portraits, NPC images, locations, etc.)
 * that are referenced in an AI message. Shows as a horizontal gallery
 * below the message content with click-to-expand functionality.
 */

import * as DialogPrimitive from '@radix-ui/react-dialog';
import React from 'react';
import { User, MapPin, Sword, Package, Image as ImageIcon, X, Sparkles, Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Z_INDEX } from '@/constants/z-index';

import type { AssetTag } from '../../utils/parse-asset-tags';
import type { CampaignAsset } from '@/hooks/use-campaign-assets';

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
 * Get icon for asset type
 */
function getAssetIcon(type: string): React.ReactNode {
  switch (type) {
    case 'character':
    case 'npc':
      return <User className="h-4 w-4" />;
    case 'location':
      return <MapPin className="h-4 w-4" />;
    case 'monster':
      return <Sword className="h-4 w-4" />;
    case 'item':
      return <Package className="h-4 w-4" />;
    case 'scene':
      return <ImageIcon className="h-4 w-4" />;
    case 'generated':
      return <Sparkles className="h-4 w-4" />;
    default:
      return <ImageIcon className="h-4 w-4" />;
  }
}

/**
 * Get gradient style for asset type
 */
function getAssetGradient(type: string): string {
  switch (type) {
    case 'character':
      return 'from-purple-600/20 to-indigo-600/20 border-purple-500/30';
    case 'npc':
      return 'from-amber-600/20 to-orange-600/20 border-amber-500/30';
    case 'location':
      return 'from-emerald-600/20 to-teal-600/20 border-emerald-500/30';
    case 'monster':
      return 'from-red-600/20 to-rose-600/20 border-red-500/30';
    case 'item':
      return 'from-cyan-600/20 to-blue-600/20 border-cyan-500/30';
    case 'scene':
      return 'from-violet-600/20 to-purple-600/20 border-violet-500/30';
    case 'generated':
      return 'from-pink-600/20 to-rose-600/20 border-pink-500/30';
    default:
      return 'from-gray-600/20 to-slate-600/20 border-gray-500/30';
  }
}

/**
 * Single asset card - larger size with click-to-expand
 */
const AssetCard: React.FC<{
  asset: CampaignAsset;
  onClick?: () => void;
}> = ({ asset, onClick }) => {
  const [imageLoaded, setImageLoaded] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center gap-2 p-3 rounded-xl',
        'bg-gradient-to-br border backdrop-blur-sm',
        'transition-all duration-200 hover:scale-105 hover:shadow-xl',
        'focus:outline-none focus:ring-2 focus:ring-purple-500/50',
        'cursor-pointer',
        getAssetGradient(asset.type)
      )}
      title={`Click to view ${asset.name}`}
    >
      {/* Image or placeholder - larger size */}
      <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-black/30 shadow-inner">
        {asset.imageUrl && !imageError ? (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
              </div>
            )}
            <img
              src={asset.imageUrl}
              alt={asset.name}
              className={cn(
                'w-full h-full object-cover transition-opacity duration-300',
                imageLoaded ? 'opacity-100' : 'opacity-0'
              )}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
            {/* Expand indicator on hover */}
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
              <span className="text-white text-xs font-medium">View</span>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/40">
            {getAssetIcon(asset.type)}
          </div>
        )}
      </div>

      {/* Name and type - more readable */}
      <div className="text-center max-w-[100px]">
        <div className="text-sm font-medium text-white/90 truncate">{asset.name}</div>
        <div className="text-[10px] text-white/50 uppercase tracking-wider">{asset.type}</div>
      </div>
    </button>
  );
};

/**
 * Generated image card - displays AI-generated scene images
 */
const GeneratedImageCard: React.FC<{
  url: string;
  onClick?: () => void;
}> = ({ url, onClick }) => {
  const [imageLoaded, setImageLoaded] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);

  return (
    <button
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center gap-2 p-3 rounded-xl',
        'bg-gradient-to-br border backdrop-blur-sm',
        'transition-all duration-200 hover:scale-105 hover:shadow-xl',
        'focus:outline-none focus:ring-2 focus:ring-pink-500/50',
        'cursor-pointer',
        getAssetGradient('generated')
      )}
      title="Click to view generated scene"
    >
      <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-black/30 shadow-inner">
        {!imageError ? (
          <>
            {!imageLoaded && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
              </div>
            )}
            <img
              src={url}
              alt="Generated scene"
              className={cn(
                'w-full h-full object-cover transition-opacity duration-300',
                imageLoaded ? 'opacity-100' : 'opacity-0'
              )}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
              <span className="text-white text-xs font-medium">View</span>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/40">
            <Sparkles className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="text-center max-w-[100px]">
        <div className="text-sm font-medium text-white/90 truncate">Scene</div>
        <div className="text-[10px] text-white/50 uppercase tracking-wider">Generated</div>
      </div>
    </button>
  );
};

/**
 * Generate button card - appears in gallery when no image yet
 */
const GenerateButtonCard: React.FC<{
  isGenerating?: boolean;
  error?: string;
  onGenerate: () => void;
}> = ({ isGenerating, error, onGenerate }) => {
  return (
    <button
      onClick={onGenerate}
      disabled={isGenerating}
      className={cn(
        'group relative flex flex-col items-center gap-2 p-3 rounded-xl',
        'bg-gradient-to-br border backdrop-blur-sm',
        'transition-all duration-200',
        isGenerating ? 'opacity-70' : 'hover:scale-105 hover:shadow-xl',
        'focus:outline-none focus:ring-2 focus:ring-pink-500/50',
        'cursor-pointer',
        getAssetGradient('generated')
      )}
      title={isGenerating ? 'Generating...' : 'Generate scene image'}
    >
      <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-black/30 shadow-inner flex items-center justify-center">
        {isGenerating ? (
          <Loader2 className="h-8 w-8 text-pink-400 animate-spin" />
        ) : (
          <Sparkles className="h-8 w-8 text-pink-400 group-hover:scale-110 transition-transform" />
        )}
      </div>
      <div className="text-center max-w-[100px]">
        <div className="text-sm font-medium text-white/90 truncate">
          {isGenerating ? 'Generating...' : 'Generate'}
        </div>
        <div className="text-[10px] text-white/50 uppercase tracking-wider">
          {error ? <span className="text-red-400">{error}</span> : 'Scene'}
        </div>
      </div>
    </button>
  );
};

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
      <DialogPrimitive.Root open={!!expandedAsset} onOpenChange={(open) => !open && setExpandedAsset(null)}>
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
                  className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors"
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
                <div className={cn(
                  'p-4 bg-gradient-to-t border-t',
                  getAssetGradient(expandedAsset.type)
                )}>
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
                  className="absolute top-3 right-3 z-10 p-2 rounded-full bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors"
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
                <div className={cn(
                  'p-4 bg-gradient-to-t border-t',
                  getAssetGradient('generated')
                )}>
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
