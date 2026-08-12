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
};

// Sonner-backed toast function compatible with existing call sites
function toast(opts: CompatToastOptions) {
  const { title, description, variant, action, duration } = opts || {};
  const hasSonnerOptions = action !== undefined || duration !== undefined;
  const sonnerOptions = {
    ...(description ? { description: String(description) } : {}),
    ...(action ? { action } : {}),
    ...(duration !== undefined ? { duration } : {}),
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
