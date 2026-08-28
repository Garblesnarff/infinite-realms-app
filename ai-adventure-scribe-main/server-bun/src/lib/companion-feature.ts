/** The companion API and its combat seating are opt-in until the feature is enabled server-side. */
export function isCompanionsEnabled(): boolean {
  const value = process.env.COMPANIONS_ENABLED?.toLowerCase();
  return value === 'true' || value === '1';
}
