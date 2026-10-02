/** Plan names the server can put on a user. `tester` is for playtest accounts (#2474). */
export type UserPlan = 'free' | 'pro' | 'enterprise' | 'tester';

/** Plans that get the paid feature set. Every plan feature gate goes through planHasPaidFeatures. */
const PAID_FEATURE_PLANS: ReadonlySet<string> = new Set(['pro', 'enterprise', 'tester']);

export function planHasPaidFeatures(plan: string | null | undefined): boolean {
  return plan != null && PAID_FEATURE_PLANS.has(plan.toLowerCase());
}
