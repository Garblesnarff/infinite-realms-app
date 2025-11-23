module.exports = {
  apps: [
    {
      name: "infinite-realms-api",
      script: "server/dist/server/src/index.js",
      cwd: "/var/www/infiniterealms/ai-adventure-scribe-main",
      instances: 1,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 8888,
        DOTENV_CONFIG_PATH: "server/.env"
      },
      error_file: "/var/log/infiniterealms/api-error.log",
      out_file: "/var/log/infiniterealms/api-out.log",
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
