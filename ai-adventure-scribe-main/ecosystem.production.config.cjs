module.exports = {
  apps: [
    {
      name: "infiniterealms-bun",
      script: "bun",
      args: "run src/index.ts",
      cwd: "/var/www/infiniterealms/ai-adventure-scribe-main/server-bun",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 8888,
        VITE_MANIFEST_PATH: "/var/www/infiniterealms/ai-adventure-scribe-main/dist/.vite/manifest.json"
      },
      error_file: "/var/log/infiniterealms/bun-error.log",
      out_file: "/var/log/infiniterealms/bun-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_memory_restart: "1G",
      watch: false
    },
    {
      name: "infinite-realms-crewai",
      script: ".venv/bin/uvicorn",
      args: "main:app --host 0.0.0.0 --port 8000",
      cwd: "/var/www/infiniterealms/ai-adventure-scribe-main/crewai-service",
      instances: 1,
      exec_mode: "fork",
      interpreter: "none",
      error_file: "/var/log/infiniterealms/crewai-error.log",
      out_file: "/var/log/infiniterealms/crewai-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_memory_restart: "1G",
      watch: false
    }
  ]
};
