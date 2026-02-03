#!/bin/bash
# Check staged files for potential secrets

# Navigate to git repo root for correct paths
cd "$(git rev-parse --show-toplevel)" || exit 1

# Pattern components (split to avoid self-detection)
SK_LIVE="sk_live"
SK_TEST="sk_test"
SECRETS_PATTERN="(${SK_LIVE}_|${SK_TEST}_|supabase_service_role|PRIVATE_KEY|-----BEGIN.*KEY|api[_-]?key\s*[:=]\s*[\"'][a-zA-Z0-9]{20,}|password\s*[:=]\s*[\"'][^\s]+)"

# Get staged files (excluding deletions and this script)
STAGED_FILES=$(git diff --cached --name-only --diff-filter=d | grep -v 'check-secrets.sh')

if [ -z "$STAGED_FILES" ]; then
    exit 0
fi

# Check for secret patterns
FOUND_SECRETS=$(echo "$STAGED_FILES" | xargs grep -lEi "$SECRETS_PATTERN" 2>/dev/null || true)

if [ -n "$FOUND_SECRETS" ]; then
    echo "❌ BLOCKED: Potential secrets detected in staged files:"
    echo "$FOUND_SECRETS"
    echo ""
    echo "Please remove secrets before committing."
    exit 1
fi

# Check for .env files (except .env.example)
ENV_FILES=$(echo "$STAGED_FILES" | grep -E '(^|/)\.env($|\.)' | grep -v '\.env\.example$' || true)

if [ -n "$ENV_FILES" ]; then
    echo "❌ BLOCKED: Attempting to commit .env files:"
    echo "$ENV_FILES"
    echo ""
    echo "Only .env.example should be committed."
    exit 1
fi

exit 0
