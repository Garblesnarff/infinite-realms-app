import React, { useLayoutEffect, useRef, useState } from 'react';

/**
 * Most genre chips on a card. The rest are counted ("+N"). The same rule as the signed-out
 * card (PublicExploreCard, #1664).
 */
export const MAX_GENRE_CHIPS = 2;

export const genreChipCountFor = (total: number): number => Math.min(MAX_GENRE_CHIPS, total);

/**
 * Genre chips on one row, whole words, left of the difficulty chip. It starts at the rule's count
 * and then drops chips until the row fits the space it is given. The fit is measured, not
 * estimated, so a wide display font or a long genre name cannot push a chip past the card edge or
 * under the difficulty chip (#1672).
 */
export const GenreChips: React.FC<{ genres: string[] }> = ({ genres }) => {
  const row = useRef<HTMLDivElement>(null);
  const total = genres.length;
  const key = genres.join('|');
  const [count, setCount] = useState(() => genreChipCountFor(total));

  // A new set of genres starts again from the rule's count.
  useLayoutEffect(() => {
    setCount(genreChipCountFor(total));
  }, [total, key]);

  // Drop one chip at a time while the row overflows; stop at one chip.
  useLayoutEffect(() => {
    const el = row.current;
    if (el && count > 1 && el.scrollWidth > el.clientWidth) setCount(count - 1);
  });

  // The row's width is set by its position, not its content, so a resize can re-measure it.
  useLayoutEffect(() => {
    const el = row.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setCount(genreChipCountFor(total)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [total]);

  if (total === 0) return null;
  const shown = genres.slice(0, count);
  const hidden = total - shown.length;
  // One chip left: a name too long for the row ends with an ellipsis instead of spilling out.
  const single = shown.length === 1;

  return (
    <div
      ref={row}
      className="absolute left-3 right-24 top-3 flex flex-nowrap items-start gap-1.5 overflow-hidden"
    >
      {shown.map((genre) => (
        <span
          key={genre}
          className={`${single ? 'min-w-0 truncate' : 'shrink-0 whitespace-nowrap'} rounded-[5px] border border-[rgba(234,238,250,0.35)] bg-[#070b14] px-2 py-[3px] font-heading text-[12px] capitalize tracking-[0.08em] text-[#eaeefa]`}
        >
          {genre}
        </span>
      ))}
      {hidden > 0 && (
        <span className="shrink-0 whitespace-nowrap rounded-[5px] border border-[rgba(234,238,250,0.35)] bg-[#070b14] px-2 py-[3px] font-heading text-[12px] tracking-[0.08em] text-[#eaeefa]">
          +{hidden}
        </span>
      )}
    </div>
  );
};
