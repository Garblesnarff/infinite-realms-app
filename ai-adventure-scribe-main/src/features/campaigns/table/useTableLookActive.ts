import { useSyncExternalStore } from 'react';

const subscribe = (notify: () => void): (() => void) => {
  const observer = new MutationObserver(notify);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

/** The shared Table setting owns the body class; this view only observes it. */
export const useTableLookActive = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => document.body.classList.contains('ir-table-look'),
    () => false,
  );
