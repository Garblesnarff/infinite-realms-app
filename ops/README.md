# Production deploy gate

`auto-deploy.sh` is the canonical host deploy script. Install or invoke this tracked copy from the existing deploy cron. It preserves the current single-writer behavior (`git reset --hard origin/main`, then PM2 restart) and runs the full API journey after the process binds port 8888.

The script sources `/etc/infiniterealms/llm-smoke.env`, requires authenticated checks, and never rolls back automatically. A failure names the checks and deployed SHA, sends the exact manual rollback command to `SLACK_ALERT_WEBHOOK_URL`, and exits non-zero. Without a working webhook it also writes `/var/log/infiniterealms/DEPLOY_FAILED_SMOKE` for cron mail and operator inspection.

Supported host overrides are `INFINITE_REALMS_REPO_ROOT`, `INFINITE_REALMS_APP_DIR`, `INFINITE_REALMS_LOG_DIR`, `BUN_BIN`, `PM2_PROCESS`, and `API_SMOKE_ENV_FILE`.
