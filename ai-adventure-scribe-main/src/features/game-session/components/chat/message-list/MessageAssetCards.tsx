import {
  User,
  MapPin,
  Sword,
  Package,
  Flag,
  Image as ImageIcon,
  Sparkles,
  Loader2,
} from 'lucide-react';
import React from 'react';

import type { CampaignAsset } from '@/hooks/use-campaign-assets';

import { cn } from '@/lib/utils';

export function getAssetIcon(type: string): React.ReactNode {
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
    case 'faction':
      return <Flag className="h-4 w-4" />;
    case 'scene':
      return <ImageIcon className="h-4 w-4" />;
    case 'generated':
      return <Sparkles className="h-4 w-4" />;
    default:
      return <ImageIcon className="h-4 w-4" />;
  }
}

export function getAssetGradient(type: string): string {
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
    case 'faction':
      return 'from-yellow-600/20 to-amber-600/20 border-yellow-500/30';
    case 'scene':
      return 'from-violet-600/20 to-purple-600/20 border-violet-500/30';
    case 'generated':
      return 'from-pink-600/20 to-rose-600/20 border-pink-500/30';
    default:
      return 'from-gray-600/20 to-slate-600/20 border-gray-500/30';
  }
}

export const AssetCard: React.FC<{
  asset: CampaignAsset;
  onClick?: () => void;
}> = ({ asset, onClick }) => {
  const [imageLoaded, setImageLoaded] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center gap-2 p-3 rounded-xl',
        'bg-gradient-to-br border backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:shadow-xl',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500/50 focus-visible:scale-105 focus-visible:shadow-xl',
        'cursor-pointer',
        getAssetGradient(asset.type),
      )}
      title={`Click to view ${asset.name}`}
      aria-label={`View ${asset.name}`}
    >
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
                imageLoaded ? 'opacity-100' : 'opacity-0',
              )}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200 flex items-center justify-center">
              <span className="text-white text-xs font-medium">View</span>
            </div>
          </>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/40">
            {getAssetIcon(asset.type)}
          </div>
        )}
      </div>
      <div className="text-center max-w-[100px]">
        <div className="text-sm font-medium text-white/90 truncate">{asset.name}</div>
        <div className="text-[10px] text-white/50 uppercase tracking-wider">{asset.type}</div>
      </div>
    </button>
  );
};

export const GeneratedImageCard: React.FC<{
  url: string;
  onClick?: () => void;
}> = ({ url, onClick }) => {
  const [imageLoaded, setImageLoaded] = React.useState(false);
  const [imageError, setImageError] = React.useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative flex flex-col items-center gap-2 p-3 rounded-xl',
        'bg-gradient-to-br border backdrop-blur-sm transition-all duration-200 hover:scale-105 hover:shadow-xl',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50 focus-visible:scale-105 focus-visible:shadow-xl',
        'cursor-pointer',
        getAssetGradient('generated'),
      )}
      title="Click to view generated scene"
      aria-label="View generated scene"
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
                imageLoaded ? 'opacity-100' : 'opacity-0',
              )}
              onLoad={() => setImageLoaded(true)}
              onError={() => setImageError(true)}
            />
            <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-200 flex items-center justify-center">
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

export const GenerateButtonCard: React.FC<{
  isGenerating?: boolean;
  error?: string;
  onGenerate: () => void;
}> = ({ isGenerating, error, onGenerate }) => {
  return (
    <button
      type="button"
      onClick={onGenerate}
      disabled={isGenerating}
      className={cn(
        'group relative flex flex-col items-center gap-2 p-3 rounded-xl',
        'bg-gradient-to-br border backdrop-blur-sm transition-all duration-200',
        isGenerating
          ? 'opacity-70'
          : 'hover:scale-105 hover:shadow-xl focus-visible:scale-105 focus-visible:shadow-xl',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500/50',
        'cursor-pointer',
        getAssetGradient('generated'),
      )}
      title={isGenerating ? 'Generating...' : 'Generate scene image'}
      aria-label={isGenerating ? 'Generating scene image' : 'Generate scene image'}
    >
      <div className="relative w-24 h-24 rounded-lg overflow-hidden bg-black/30 shadow-inner flex items-center justify-center">
        {isGenerating ? (
          <Loader2 className="h-8 w-8 text-pink-400 animate-spin" />
        ) : (
          <Sparkles className="h-8 w-8 text-pink-400 group-hover:scale-110 group-focus-visible:scale-110 transition-transform" />
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
