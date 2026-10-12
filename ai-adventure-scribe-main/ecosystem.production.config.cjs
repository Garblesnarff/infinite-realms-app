const fs = require('node:fs');

/**
 * Alerting env is loaded declaratively here rather than inherited from whatever shell
 * happened to start pm2.
 *
 * `SLACK_ALERT_WEBHOOK_URL` used to exist only as inherited process env, surviving via
 * pm2's in-memory state plus `dump.pm2`. Anyone restarting the server from a shell that
 * had not sourced `/etc/infiniterealms/alerts.env` silently disabled every Slack alert —
 * `postToWebhook()` returns early on an empty URL with no error and no log line. See
 * issue #1888. pm2 6.x has no `env_file` option, so the file is parsed here and folded
 * into `env`.
 *
 * The file is server-local (root-owned, 0600) and deliberately NOT in the repo. Its
 * absence is not fatal: the server boots with alerting disabled and now says so on
 * startup (`Slack alerting: DISABLED (no webhook URL)`).
 */
const ALERTS_ENV_PATH = process.env.IR_ALERTS_ENV_PATH || '/etc/infiniterealms/alerts.env';

/** Minimal `KEY=value` parser for a shell-sourceable env file. Never throws. */
function readEnvFile(filePath) {
  let contents;
  try {
    contents = fs.readFileSync(filePath, 'utf8');
  } catch {
    return {};
  }

  const parsed = {};
  for (const rawLine of contents.split('\n')) {
    // The file is `source`d by the cron consumers, so tolerate `export KEY=value`.
    const line = rawLine.trim().replace(/^export\s+/, '');
    if (!line || line.startsWith('#')) continue;

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) continue;

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();
    const isQuoted =
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")));
    if (isQuoted) value = value.slice(1, -1);

    parsed[key] = value;
  }
  return parsed;
}

const LIVE_APP = {
  name: 'infiniterealms-bun',
  script: 'bun',
  args: 'run src/index.ts',
  cwd: '/var/www/infiniterealms/ai-adventure-scribe-main/server-bun',
  instances: 1,
  exec_mode: 'fork',
  env: {
    // Spread first so the explicit settings below always win over the file.
    ...readEnvFile(ALERTS_ENV_PATH),
    NODE_ENV: 'production',
    TRUST_PROXY_HEADERS: 'true',
    PORT: 8888,
    VITE_MANIFEST_PATH: '/var/www/infiniterealms/ai-adventure-scribe-main/dist/.vite/manifest.json',
  },
  error_file: '/var/log/infiniterealms/bun-error.log',
  out_file: '/var/log/infiniterealms/bun-out.log',
  log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  merge_logs: true,
  autorestart: true,
  kill_timeout: 8000,
  max_memory_restart: '1G',
  watch: false,
};

/**
 * Deploy handoff standby (#422). ops/auto-deploy.sh starts it with
 * `IR_INCLUDE_STANDBY=1 pm2 start <this file> --only infiniterealms-bun-standby`,
 * so it serves :8888 (SO_REUSEPORT) while the live app restarts, then deletes
 * it. It is listed only when IR_INCLUDE_STANDBY=1, so a plain
 * `pm2 start ecosystem.production.config.cjs` still starts the live app alone.
 * Same config as the live app, but it never restarts itself and runs no
 * background sweeps (IR_STANDBY=1, see server-bun/src/index.ts).
 */
const STANDBY_APP = {
  ...LIVE_APP,
  name: 'infiniterealms-bun-standby',
  env: { ...LIVE_APP.env, IR_STANDBY: '1' },
  autorestart: false,
  max_memory_restart: undefined,
};

module.exports = {
  apps: process.env.IR_INCLUDE_STANDBY === '1' ? [LIVE_APP, STANDBY_APP] : [LIVE_APP],
};
