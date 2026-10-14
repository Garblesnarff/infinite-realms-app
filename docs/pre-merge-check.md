# Pre-Merge Check Tooling (`scripts/pre-merge-check.sh`)

`scripts/pre-merge-check.sh` is a local-only, read-only helper script designed to detect file path overlaps and git merge conflicts prior to merging PRs or branches.

It addresses two specific pre-merge check failure modes:
1. **Abbreviated Path Match Inaccuracies**: Using `git show --stat` abbreviates long file paths (e.g. `.../src/services/ai-service.ts`), causing exact substring matches to miss overlapping files. `scripts/pre-merge-check.sh` uses full unabridged file paths (`git diff --name-only`).
2. **Merge Tree False Negatives**: `git merge-tree` without `--write-tree` does not produce standard inline conflict markers (`<<<<<<<`), resulting in false-clean reports on conflicting commits. `scripts/pre-merge-check.sh` uses `git merge-tree --write-tree <base> <head>` to accurately verify whether a merge succeeds or fails.

---

## Usage

### 1. Check a PR by PR Number
If `gh` CLI is installed and authenticated, you can pass a PR number:

```bash
scripts/pre-merge-check.sh 2053
```

The base is the branch's current tip on `origin` (read with `git ls-remote`), not the local `origin/<base>` ref, which can be stale. If that tip is not in the local object database, the check fails closed. It never fetches.

### 2. Check Specific Git References
Pass base and head references explicitly:

```bash
scripts/pre-merge-check.sh origin/main feature-branch
```

---

## Behavior & Exit Codes

- **Exact Base and Head Reporting**: Outputs the resolved full SHA for both base and head references.
- **Overlap Check (Coordination Evidence)**: Lists any files modified on both base and head relative to their common merge base using unabridged paths. Note that file path overlaps represent coordination evidence and do not necessarily mean there is a git merge conflict.
- **Merge Conflict Check**: Runs `git merge-tree --write-tree`.
  - Exit code `0`: Merge succeeds without conflicts.
  - Exit code `1`: Merge conflict detected OR invalid/unresolvable inputs provided (fails closed).

---

## Running Test Suite

To verify the helper script against clean, overlapping, conflicting, and invalid scenarios, run:

```bash
bash scripts/tests/pre-merge-check.test.sh
```
