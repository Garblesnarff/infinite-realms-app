## Exact CI proposal — not applied

Rob's typed authorization is still required for `.github/workflows/*`. This is a reviewable proposal only. The app gate keys package + advisory + lock domain, checks owner/reason/expiry, fails new high/critical advisories, and expires accepted baseline entries on 2026-11-03. Low/moderate remain visible in the raw audit. This is temporary triage acceptance, not a finding that packages are safe. Renewals need a documented reason. The lore/ingest npm JSON format needs a separate adapter and per-domain entries before those domains are gated; an app allowlist must never suppress them.

Proposed workflow insertion after the checks job's app install; new helper and initial allowlist are shown in the same diff. No live file in this proposal is installed by this PR.

```diff
diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -173,6 +173,16 @@
       - id: install
         if: ${{ !cancelled() }}
         run: bun install --frozen-lockfile
+      - name: Dependency advisories (app)
+        if: ${{ !cancelled() && steps.install.outcome == 'success' }}
+        run: |
+          audit_status=0
+          bun audit --json > /tmp/app-audit.json || audit_status=$?
+          test -s /tmp/app-audit.json
+          bun scripts/check-dependency-advisories.ts /tmp/app-audit.json
+          # The checker accepts only valid audit JSON; network/registry errors fail closed.
+          # npm lock domains need separately keyed npm-format checks, not this Bun parser.
+          # A nonzero audit status alone is expected for explicitly accepted baseline entries.
       - id: install-server
         if: ${{ !cancelled() && steps.install.outcome == 'success' }}
         run: bun install --frozen-lockfile
diff --git a/ai-adventure-scribe-main/scripts/check-dependency-advisories.ts b/ai-adventure-scribe-main/scripts/check-dependency-advisories.ts
new file mode 100644
--- /dev/null
+++ b/ai-adventure-scribe-main/scripts/check-dependency-advisories.ts
@@ -0,0 +1,17 @@
+import { readFileSync } from 'node:fs';
+const audit = JSON.parse(readFileSync(process.argv[2], 'utf8'));
+const allow = JSON.parse(readFileSync('security/advisory-allowlist.json', 'utf8'));
+const today = new Date().toISOString().slice(0, 10);
+const failures = [];
+for (const [pkg, advisories] of Object.entries(audit)) {
+  if (!Array.isArray(advisories)) throw new Error('Unexpected audit format');
+  for (const entry of advisories) {
+    if (!['high', 'critical'].includes(entry.severity)) continue;
+    const id = entry.url?.split('/').pop();
+    const accepted = allow.find((a) => a.domain === 'app' && a.package === pkg && a.advisory === id);
+    if (!accepted || !accepted.owner || !accepted.reason || !accepted.expires || accepted.expires < today) {
+      failures.push(`${pkg}: ${id ?? 'missing advisory id'}`);
+    }
+  }
+}
+if (failures.length) throw new Error(`Unaccepted advisories:\n${[...new Set(failures)].join('\n')}`);
diff --git a/ai-adventure-scribe-main/security/advisory-allowlist.json b/ai-adventure-scribe-main/security/advisory-allowlist.json
new file mode 100644
--- /dev/null
+++ b/ai-adventure-scribe-main/security/advisory-allowlist.json
@@ -0,0 +1,226 @@
+[
+  {
+    "domain": "app",
+    "package": "brace-expansion",
+    "advisory": "GHSA-mh99-v99m-4gvg",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "brace-expansion",
+    "advisory": "GHSA-rgw5-rvv9-x895",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "brace-expansion",
+    "advisory": "GHSA-3jxr-9vmj-r5cp",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "brace-expansion",
+    "advisory": "GHSA-qhr7-859c-m2p7",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "brace-expansion",
+    "advisory": "GHSA-6j4f-fj2g-mc7p",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "braces",
+    "advisory": "GHSA-vfj7-8cjw-p6xm",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "browserslist",
+    "advisory": "GHSA-c83g-rgw3-j3cx",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "browserslist",
+    "advisory": "GHSA-73wf-gq98-2v4g",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "drizzle-orm",
+    "advisory": "GHSA-gpj5-g38j-94v9",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "form-data",
+    "advisory": "GHSA-hmw2-7cc7-3qxx",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "js-yaml",
+    "advisory": "GHSA-52cp-r559-cp3m",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "js-yaml",
+    "advisory": "GHSA-5p4m-2wfm-xmqj",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "js-yaml",
+    "advisory": "GHSA-2883-xcg3-v3hh",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "mathjs",
+    "advisory": "GHSA-29qv-4j9f-fjw5",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "mathjs",
+    "advisory": "GHSA-jvff-x2qm-6286",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "nanoid",
+    "advisory": "GHSA-28wg-ghj8-5hjv",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "nanoid",
+    "advisory": "GHSA-2v37-7h3g-55p8",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "postcss",
+    "advisory": "GHSA-r28c-9q8g-f849",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "sharp",
+    "advisory": "GHSA-f88m-g3jw-g9cj",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "sharp",
+    "advisory": "GHSA-rgj7-g3m4-5g8c",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "sharp",
+    "advisory": "GHSA-wq5f-xc86-pv6w",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "shell-quote",
+    "advisory": "GHSA-w7jw-789q-3m8p",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "shell-quote",
+    "advisory": "GHSA-395f-4hp3-45gv",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "source-map-js",
+    "advisory": "GHSA-68fv-2mgg-jv7q",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "tinypool",
+    "advisory": "GHSA-5gmw-xhrv-c9v3",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "tinypool",
+    "advisory": "GHSA-85c8-ppgw-ccpr",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "vite",
+    "advisory": "GHSA-fx2h-pf6j-xcff",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  },
+  {
+    "domain": "app",
+    "package": "vitest",
+    "advisory": "GHSA-5xrq-8626-4rwp",
+    "owner": "issue-843",
+    "expires": "2026-11-03",
+    "reason": "See docs/security/dependency-triage-843.md; bounded follow-up required"
+  }
+]
```

Friction / simplification: Bun and npm emit incompatible audit shapes. The helper deliberately fails on an unexpected shape rather than accidentally treating a registry error as a clean result.
