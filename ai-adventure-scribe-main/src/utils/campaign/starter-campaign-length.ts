/**
 * Length label shown on a starter campaign's detail page.
 *
 * A one-shot's overview declares its length as "One-shot — 1 session
 * (2–4 hours)", but the ingest parser stored the hours range as
 * `estimated_sessions`, so the detail page rendered "2-4 sessions" (#829).
 * When the overview's Estimated Length line declares a one-shot, the label
 * comes from that line: "One-shot (2–4 hours)", or "One-shot" when the line
 * gives no hours range. Returns null when the overview declares no one-shot,
 * so the caller falls back to the stored sessions label unchanged.
 */
export function formatStarterCampaignLength(overview: string | null | undefined): string | null {
  if (!overview) return null;

  const line = overview.match(/Estimated Length:[*\s]*(\S.*)/i)?.[1];
  if (!line || !/one-shot/i.test(line)) return null;

  const hours = line.match(/(\d+)\s*[-–]\s*(\d+)\s*hours/i);
  return hours ? `One-shot (${hours[1]}–${hours[2]} hours)` : 'One-shot';
}
