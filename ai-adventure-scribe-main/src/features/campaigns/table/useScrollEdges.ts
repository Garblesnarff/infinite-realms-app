import { useEffect, useState, type RefObject } from 'react';

export interface ScrollEdges {
  /** Content is scrolled out of view on the left. */
  left: boolean;
  /** Content is scrolled out of view on the right. */
  right: boolean;
}

export const scrollEdgesFor = (el: {
  scrollLeft: number;
  scrollWidth: number;
  clientWidth: number;
}): ScrollEdges => ({
  left: el.scrollLeft > 1,
  right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
});

/** Which edges of a horizontal scroller hide content, kept current on scroll and resize (#1672). */
export const useScrollEdges = (ref: RefObject<HTMLElement | null>): ScrollEdges => {
  const [edges, setEdges] = useState<ScrollEdges>({ left: false, right: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const update = (): void => {
      const next = scrollEdgesFor(el);
      setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [ref]);

  return edges;
};
