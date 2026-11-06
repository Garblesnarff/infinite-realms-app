import React from 'react';

/** Keep the placeholder usable when the image service cannot render a resized copy. */
export function TableImage({
  src,
  alt,
  fallback,
  className,
  width,
  height,
  loading,
}: {
  src: string | null;
  alt: string;
  fallback: React.ReactNode;
  className: string;
  width: number;
  height: number;
  loading?: 'eager' | 'lazy';
}): React.JSX.Element {
  const [failed, setFailed] = React.useState<string | null>(null);
  if (!src || failed === src) return <>{fallback}</>;
  return (
    <img
      src={src}
      alt={alt}
      className={className}
      width={width}
      height={height}
      loading={loading}
      onError={() => setFailed(src)}
    />
  );
}
