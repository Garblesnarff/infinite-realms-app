/** Request a resized public-storage image; never fall back to an unbounded original. */
export function tableImageUrl(source: string | null, width: number, height: number): string | null {
  if (!source) return null;
  try {
    const url = new URL(source);
    const marker = '/storage/v1/object/public/';
    if (!['https:', 'http:'].includes(url.protocol) || !url.pathname.includes(marker)) return null;
    url.pathname = url.pathname.replace(marker, '/storage/v1/render/image/public/');
    url.searchParams.set('width', String(width));
    url.searchParams.set('height', String(height));
    url.searchParams.set('resize', 'cover');
    url.searchParams.set('quality', '75');
    return url.toString();
  } catch {
    return null;
  }
}
