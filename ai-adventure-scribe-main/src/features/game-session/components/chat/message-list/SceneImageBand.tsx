import React from 'react';

import { cn } from '@/lib/utils';

interface SceneImageBandProps {
  url: string;
  caption: string;
  /** Called once when the picture fails to load, so the message can offer to illustrate again. */
  onFailed?: () => void;
}

/**
 * The scene art for a DM message, shown above that message's story text (#1236 D). A picture
 * that fails to load is dropped, so no broken image shows.
 */
export const SceneImageBand: React.FC<SceneImageBandProps> = ({ url, caption, onFailed }) => {
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);

  if (failed) {
    return null;
  }

  return (
    <figure className="mb-3 max-w-[72ch] overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open ${caption} full size`}
        className="block"
      >
        <img
          src={url}
          alt={caption}
          loading="lazy"
          onLoad={() => setLoaded(true)}
          onError={() => {
            setFailed(true);
            onFailed?.();
          }}
          className={cn(
            'block h-auto max-h-[200px] w-full object-cover transition-opacity duration-300 md:max-h-60',
            loaded ? 'opacity-100' : 'opacity-0',
          )}
        />
      </a>
      <figcaption className="px-3 py-1.5 text-xs uppercase tracking-wider text-white/60">
        {caption}
      </figcaption>
    </figure>
  );
};
