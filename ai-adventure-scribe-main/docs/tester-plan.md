# The `tester` plan (#2474)

`users.plan = 'tester'` is for playtest accounts (Terra, Muse, the design tester). It is set by hand in prod data; no Stripe flow ever assigns it.

## What it does

- Quotas (`DEFAULT_QUOTAS.tester` in `server-bun/src/services/ai-usage-service.ts`): `llm` 500, `llm_system` 5000, `image` 50, `voice` 200 calls' worth (same as pro) per day.
- Feature gates: every plan gate calls `planHasPaidFeatures(plan)` from `shared/plan-features.ts`, which is true for `pro`, `enterprise` and `tester`. Do not compare against `'pro'` or `!== 'free'` directly.
- Rate limits: a plan with no bucket of its own in `maxByPlan` uses the `pro` bucket when `planHasPaidFeatures` is true, else the `free` bucket.
- Account page and nav badge show "Tester". There is no Upgrade or Manage Subscription button.
- Billing webhooks: `customer.subscription.updated` and `.deleted` skip a `tester` row that has no `stripe_subscription_id`. The charge and dispute handlers already ignore a user with no matching subscription on file.

## Excluding testers from cost reports

`ai_usage.plan` records the user's plan on every row, so tester spend is `plan = 'tester'`. Profit-per-subscriber math must leave it out:

```sql
SELECT plan, SUM(cost_usd) AS cost_usd
FROM ai_usage
WHERE plan IS DISTINCT FROM 'tester'
  AND period_start >= date_trunc('month', now())
GROUP BY plan;
```

Use `IS DISTINCT FROM`, not `<>`: `plan` is nullable and `plan <> 'tester'` drops NULL rows. To see tester spend on its own, filter `plan = 'tester'`.

## Assigning the plan

Not part of the code change. It is a prod-data update on Rob's typed line:

```sql
UPDATE users SET plan = 'tester', updated_at = NOW() WHERE id = '<user id>' AND stripe_subscription_id IS NULL;
```

The auth layer caches plans for 5 minutes (`UserPlanCache`), so the new plan applies within that window.
