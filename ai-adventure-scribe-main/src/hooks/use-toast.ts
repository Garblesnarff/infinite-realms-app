import * as React from 'react';
import { toast as sonnerToast } from 'sonner';

type CompatToastOptions = {
  title?: React.ReactNode;
  description?: React.ReactNode;
  variant?: 'default' | 'destructive';
  action?: {
    label: string;
    onClick: () => void;
  };
  duration?: number;
  /** Sonner placement for this toast only; the Toaster default (bottom-right) otherwise. */
  position?:
    | 'top-left'
    | 'top-center'
    | 'top-right'
    | 'bottom-left'
    | 'bottom-center'
    | 'bottom-right';
  /** Show sonner's close (X) button on this toast. */
  closeButton?: boolean;
};

// Sonner-backed toast function compatible with existing call sites
function toast(opts: CompatToastOptions) {
  const { title, description, variant, action, duration, position, closeButton } = opts || {};
  const hasSonnerOptions =
    action !== undefined ||
    duration !== undefined ||
    position !== undefined ||
    closeButton !== undefined;
  const sonnerOptions = {
    ...(description ? { description: String(description) } : {}),
    ...(action ? { action } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(position !== undefined ? { position } : {}),
    ...(closeButton !== undefined ? { closeButton } : {}),
  };
  const message = String(description || title || '');

  let id: string | number;
  if (variant === 'destructive') {
    if (title && description) {
      id = hasSonnerOptions
        ? sonnerToast.error(String(title), sonnerOptions)
        : sonnerToast.error(String(title), { description: String(description) });
    } else if (hasSonnerOptions) {
      id = sonnerToast.error(message, sonnerOptions);
    } else {
      id = sonnerToast.error(message);
    }
  } else if (title && description) {
    id = hasSonnerOptions
      ? sonnerToast(String(title), sonnerOptions)
      : sonnerToast(String(title), { description: String(description) });
  } else if (hasSonnerOptions) {
    id = sonnerToast(message, sonnerOptions);
  } else {
    id = sonnerToast(message);
  }

  return {
    id: String(id),
    dismiss: () => sonnerToast.dismiss(id),
    update: (_next: CompatToastOptions) => {
      // no-op for now; can be wired to sonner's custom update if needed
    },
  };
}

function useToast() {
  // Keep hook signature; most callers only use { toast }
  const memoToast = React.useMemo(() => toast, []);
  const dismiss = React.useCallback((toastId?: string) => {
    if (toastId) sonnerToast.dismiss(toastId);
    else sonnerToast.dismiss();
  }, []);

  // ⚡ Bolt: Wrap the returned object in useMemo to enforce referential stability
  // and prevent downstream component re-renders when consumed context/toast handlers are stable.
  return React.useMemo(
    () => ({
      toasts: [] as never[],
      toast: memoToast,
      dismiss,
    }),
    [memoToast, dismiss],
  );
}

export { useToast, toast };
