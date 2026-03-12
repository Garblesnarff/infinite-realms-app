import { useEffect, useRef, useState } from 'react';

import logger from '@/lib/logger';

export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface UseAutosaveReturn<T> {
  status: AutosaveStatus;
  restore: () => T | null;
  clear: () => void;
}

export function useAutosave<T>(
  storageKey: string,
  value: T,
  opts?: { delay?: number },
): UseAutosaveReturn<T> {
  const { delay = 1000 } = opts || {};
  const timer = useRef<number | null>(null);
  const [status, setStatus] = useState<AutosaveStatus>('idle');

  useEffect(() => {
    setStatus('saving');
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      try {
        localStorage.setItem(storageKey, JSON.stringify(value));
        setStatus('saved');
        window.setTimeout(() => setStatus('idle'), 1200);
      } catch (err) {
        logger.error('Autosave error', err);
        setStatus('error');
      }
    }, delay);

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [storageKey, value, delay]);

  function restore(): T | null {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      logger.error('Autosave restore failed', err);
      return null;
    }
  }

  function clear(): void {
    try {
      localStorage.removeItem(storageKey);
      setStatus('idle');
    } catch (err) {
      logger.error('Autosave clear failed', err);
    }
  }

  return { status, restore, clear };
}
