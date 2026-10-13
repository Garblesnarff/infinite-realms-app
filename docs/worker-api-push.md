# Worker API-Push Guide for Environments Without `origin` Remote

This guide describes how workers operating in environment snapshots without an `origin` remote (such as local tarball extracts or restricted environments) can create branches, push commits, and open draft pull requests via the GitHub REST API using the Git Data API flow.

> **Note:** This document provides inert placeholder examples for reference only. Do not execute real API pushes during documentation tests or verification.

---

## 1. Safe Credential Handling

- **Never hardcode personal access tokens or secrets** in scripts, payloads, or documentation.
- Always retrieve credentials from environment variables such as `GITHUB_TOKEN` or `GH_TOKEN`.
- Do not log HTTP authorization headers or print full environment variables in stdout/stderr logs.

```bash
# Example environment setup using environment variables
export GITHUB_TOKEN="${GITHUB_TOKEN:-$GH_TOKEN}"
```

Headers required for GitHub API HTTP requests:
```http
Authorization: Bearer <GITHUB_TOKEN>
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28
```

---

## 2. Step 1: Verification of `main` SHA and Tree

Before creating changes, verify the current `main` branch SHA and tree root SHA from GitHub to ensure you are branching off the latest upstream state.

### Request: Get Branch Details
```http
GET /repos/{owner}/{repo}/branches/main HTTP/1.1
Host: api.github.com
Authorization: Bearer <GITHUB_TOKEN>
Accept: application/vnd.github+json
```

### Example Curl Command
```bash
curl -s -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/OWNER/REPO/branches/main"
```

### Expected Response Payload (Partial)
```json
{
  "name": "main",
  "commit": {
    "sha": "a1b2c3d4e5f67890123456789abcdef012345678",
    "commit": {
      "tree": {
        "sha": "9876543210fedcba9876543210fedcba98765432"
      }
    }
  }
}
```

Record `base_commit_sha` (`a1b2c3d4e5f6...`) and `base_tree_sha` (`9876543210fe...`).

---

## 3. Step 2: Existing-Branch Collision Refusal

Workers must refuse to push if the target branch ref already exists on the remote repository. Check the reference status before attempting to create the branch.

### Request: Get Reference
```http
GET /repos/{owner}/{repo}/git/ref/heads/{branch_name} HTTP/1.1
Host: api.github.com
Authorization: Bearer <GITHUB_TOKEN>
Accept: application/vnd.github+json
```

### Example Curl Command
```bash
curl -s -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/OWNER/REPO/git/ref/heads/YOUR_BRANCH_NAME"
```

- If HTTP status code is `200 OK`, the branch **already exists**. **Abort immediately** to avoid collision or unauthorized overwrite.
- If HTTP status code is `404 Not Found`, the target branch name is available. Proceed with the push flow.

---

## 4. Step 3: Git Data API Flow (Blobs → Tree → Commit → Ref)

### 4.1 Create Blobs for Changed Files

For each file added or modified in your change, create a blob on GitHub.

#### Request: Create Blob
```http
POST /repos/{owner}/{repo}/git/blobs HTTP/1.1
Host: api.github.com
Authorization: Bearer <GITHUB_TOKEN>
Content-Type: application/json

{
  "content": "# Document text content...",
  "encoding": "utf-8"
}
```

#### Example Python Snippet (Inert Pattern)
```python
import os
import requests

def create_blob(owner, repo, token, file_content):
    url = f"https://api.github.com/repos/{owner}/{repo}/git/blobs"
    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
    }
    payload = {
        "content": file_content,
        "encoding": "utf-8"
    }
    response = requests.post(url, headers=headers, json=payload)
    response.raise_for_status()
    return response.json()["sha"]
```

Record the returned blob SHA for each file path.

---

### 4.2 Create a New Git Tree

Combine the newly created file blobs into a new tree using `base_tree` SHA obtained in Step 1.

#### Request: Create Tree
```http
POST /repos/{owner}/{repo}/git/trees HTTP/1.1
Host: api.github.com
Authorization: Bearer <GITHUB_TOKEN>
Content-Type: application/json

{
  "base_tree": "9876543210fedcba9876543210fedcba98765432",
  "tree": [
    {
      "path": "docs/worker-api-push.md",
      "mode": "100644",
      "type": "blob",
      "sha": "blob_sha_from_step_3_1"
    }
  ]
}
```

- `mode`: `"100644"` for standard files, `"100755"` for executable files, `"040000"` for subdirectories.
- `type`: `"blob"`.

Record the returned `tree.sha`.

---

### 4.3 Create a Git Commit

Create a commit pointing to the new tree and referencing the `base_commit_sha` as its parent.

#### Request: Create Commit
```http
POST /repos/{owner}/{repo}/git/commits HTTP/1.1
Host: api.github.com
Authorization: Bearer <GITHUB_TOKEN>
Content-Type: application/json

{
  "message": "docs(area): short description of changes (#N)\n\nDetailed commit body.",
  "tree": "new_tree_sha_from_step_3_2",
  "parents": ["a1b2c3d4e5f67890123456789abcdef012345678"]
}
```

Record the returned commit `sha` (this is your new `head_sha`).

---

### 4.4 Create Branch Reference

Create the new git ref for your branch.

#### Request: Create Reference
```http
POST /repos/{owner}/{repo}/git/refs HTTP/1.1
Host: api.github.com
Authorization: Bearer <GITHUB_TOKEN>
Content-Type: application/json

{
  "ref": "refs/heads/YOUR_BRANCH_NAME",
  "sha": "new_commit_sha_from_step_3_3"
}
```

Verify that the server returns `201 Created`.

---

## 5. Step 4: Draft Pull Request Creation

Create a draft pull request targeting `main`.

#### Request: Create Pull Request
```http
POST /repos/{owner}/{repo}/pulls HTTP/1.1
Host: api.github.com
Authorization: Bearer <GITHUB_TOKEN>
Content-Type: application/json

{
  "title": "docs(area): summary (#N)",
  "head": "YOUR_BRANCH_NAME",
  "base": "main",
  "body": "For strategist review.\n\nDo not merge — for review\n\nRoot cause / Context:\n...\n\nFriction / simplification:\nnone\n\nHead SHA: <new_commit_sha>",
  "draft": true
}
```

- Ensure `"draft": true` is explicitly included.
- Body must start with `For strategist review.` and include `Do not merge — for review`.

---

## 6. Step 5: Local Checkout State Preservation and Exact-Head Evidence

When pushing via API from a snapshot directory:
- **Preserve Local State:** Do not modify or destroy the local working tree unnecessarily. Keep local untracked files and local changes clean or preserved.
- **Exact-Head Evidence:** Record and report the exact remote commit SHA generated by the `POST /repos/{owner}/{repo}/git/commits` API endpoint. Never report a fabricated or stale local SHA as the remote PR head SHA.
