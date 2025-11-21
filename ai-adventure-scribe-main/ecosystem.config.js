/**
 * PM2 Ecosystem Configuration for InfiniteRealms Production
 *
 * Usage:
 *   pm2 start ecosystem.config.js
 *   pm2 stop ecosystem.config.js
 *   pm2 restart ecosystem.config.js
 *   pm2 logs infinite-realms-server
 */

module.exports = {
  apps: [
    {
      name: 'infinite-realms-server',
      script: './server/dist/index.js',

      // Runtime Configuration
      instances: 1,
      exec_mode: 'fork',

      // Environment Variables
      env: {
        NODE_ENV: 'production',
        PORT: 8888,
        // Load from .env file:
        // DATABASE_URL, JWT_SECRET, OPENAI_API_KEY, etc.
      },

      // Advanced Options
      watch: false,
      max_memory_restart: '1G',
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // Restart Policy
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',

      // Process Management
      kill_timeout: 5000,
      wait_ready: true,
      listen_timeout: 10000,
    }
  ],

  // Optional: Deployment configuration
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/main',
      repo: 'git@github.com:yourusername/infinite-realms.git',
      path: '/var/www/infinite-realms',
      'post-deploy': 'npm install && npm run build && pm2 reload ecosystem.config.js'
    }
  }
};
