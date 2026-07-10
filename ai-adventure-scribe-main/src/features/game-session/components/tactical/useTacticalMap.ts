import { useCallback, useEffect, useRef, useState } from 'react';

import { applyTacticalDelta, type Point, type TacticalDelta, type TacticalMap } from './tactical-map-state';

const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:8888';
const headers = () => ({ Authorization: `Bearer ${window.localStorage.getItem('workos_access_token') ?? ''}` });

export function useTacticalMap(sessionId: string) {
  const [map, setMap] = useState<TacticalMap | null>(null);
  const [animation, setAnimation] = useState<{ entityId: string; path: Point[]; step: number } | null>(null);
  const frameRef = useRef<number>();

  const applyDelta = useCallback((delta: TacticalDelta) => {
    setMap((current) => applyTacticalDelta(current, delta));
    if (delta.type === 'entity_moved' && delta.path.length > 1) setAnimation({ entityId: delta.entityId, path: delta.path, step: 0 });
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`${apiBase}/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map`, { headers: headers() })
      .then(async (response) => response.ok ? response.json() as Promise<TacticalMap> : null)
      .then((next) => { if (!cancelled && next) setMap(next); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    const listener = (event: Event) => applyDelta((event as CustomEvent<TacticalDelta>).detail);
    window.addEventListener('tactical-map-delta', listener);
    return () => window.removeEventListener('tactical-map-delta', listener);
  }, [applyDelta]);

  useEffect(() => {
    if (!animation) return;
    let started = 0;
    const tick = (now: number) => {
      if (!started) started = now;
      const step = Math.min(animation.path.length - 1, Math.floor((now - started) / 80));
      setAnimation((current) => current && current.step === step ? current : { ...animation, step });
      if (step < animation.path.length - 1) frameRef.current = requestAnimationFrame(tick);
      else frameRef.current = undefined;
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => { if (frameRef.current) cancelAnimationFrame(frameRef.current); };
  }, [animation?.entityId, animation?.path]);

  const request = useCallback(async <T,>(path: string, init?: RequestInit) => {
    const response = await fetch(`${apiBase}/v1/sessions/${encodeURIComponent(sessionId)}/tactical-map${path}`, {
      ...init, headers: { ...headers(), 'Content-Type': 'application/json', ...init?.headers },
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, data: data as T };
  }, [sessionId]);

  return { map, animation, applyDelta, request };
}
