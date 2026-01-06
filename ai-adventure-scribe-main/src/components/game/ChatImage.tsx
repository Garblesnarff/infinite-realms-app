import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import React from 'react';

import { Z_INDEX } from '@/constants/z-index';

type Props = {
  url: string;
  alt?: string;
  className?: string;
};

/**
 * ChatImage
 * Thumbnail (about 1/4 width) that opens a fullscreen lightbox on click.
 * Uses very high z-index to ensure lightbox appears above all game UI elements.
 */
export const ChatImage: React.FC<Props> = ({ url, alt = 'Scene image', className }) => {
  return (
    <DialogPrimitive.Root>
      <DialogPrimitive.Trigger asChild>
        <img
          src={url}
          alt={alt}
          loading="lazy"
          className={[
            'mx-auto w-1/4 min-w-[200px] max-w-[320px] h-auto object-contain rounded-md shadow-md border border-white/20 cursor-zoom-in',
            className || '',
          ].join(' ')}
        />
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        {/* Overlay with very high z-index to appear above all game UI */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-black/90 backdrop-blur-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0"
          style={{ zIndex: Z_INDEX.IMAGE_LIGHTBOX_BACKDROP }}
        />
        {/* Content with very high z-index */}
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] -translate-x-1/2 -translate-y-1/2 p-0 bg-transparent border-0 shadow-none w-[96vw] max-w-[96vw] max-h-[96vh] focus:outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          style={{ zIndex: Z_INDEX.IMAGE_LIGHTBOX }}
        >
          {/* Screen reader accessible title */}
          <DialogPrimitive.Title className="sr-only">Scene image preview</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Enlarged view of the selected chat scene illustration.
          </DialogPrimitive.Description>
          {/* Centering wrapper to avoid layout shift when close button is present */}
          <div className="relative mx-auto max-w-[95vw] max-h-[90vh]">
            <img
              src={url}
              alt={alt}
              className="mx-auto max-w-full max-h-[90vh] object-contain rounded-md"
            />
            {/* Prominent close button */}
            <DialogPrimitive.Close className="absolute -top-3 -right-3 inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/70 text-white shadow-lg hover:bg-black/80 focus:outline-none focus:ring-2 focus:ring-white/60">
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </DialogPrimitive.Close>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default ChatImage;
