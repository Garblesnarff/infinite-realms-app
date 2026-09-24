/**
 * The image model the server actually uses (#2157/#2177): the
 * OPENROUTER_IMAGE_MODEL env value, else the code default. Exposed on /health
 * (#2201) so "which model is live" needs no env-file or /proc reading. Returns
 * the model name only — never read any other env value through this.
 *
 * routes/v1/images.ts still inlines the same expression; a test keeps the two
 * in step until it switches to this helper.
 */
export const DEFAULT_IMAGE_MODEL = 'google/gemini-3.1-flash-image';

export function resolveImageModel(env: Record<string, string | undefined> = process.env): string {
  return env.OPENROUTER_IMAGE_MODEL || DEFAULT_IMAGE_MODEL;
}
