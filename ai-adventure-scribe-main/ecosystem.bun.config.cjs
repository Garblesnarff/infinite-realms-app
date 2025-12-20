module.exports = {
  apps: [{
    name: 'infiniterealms-bun',
    script: 'bun',
    args: 'run src/index.ts',
    cwd: '/var/www/infiniterealms/ai-adventure-scribe-main/server-bun',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      VITE_MANIFEST_PATH: '/var/www/infiniterealms/ai-adventure-scribe-main/dist/.vite/manifest.json',
    },
    out_file: '/var/log/infiniterealms/bun-out.log',
    error_file: '/var/log/infiniterealms/bun-error.log',
    merge_logs: true,
  }],
};
