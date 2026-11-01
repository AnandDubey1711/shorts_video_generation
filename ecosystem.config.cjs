// pm2 process file: `pm2 start ecosystem.config.cjs` (see package.json pm2:* scripts)
module.exports = {
  apps: [
    {
      name: 'shorts-video-generation',
      script: 'src/index.js',
      cwd: __dirname,
      instances: 1, // single instance: the bullmq worker runs in this process, more would render in parallel
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      kill_timeout: 10000,
      watch: false,
      out_file: 'logs/pm2-out.log',
      error_file: 'logs/pm2-error.log',
      time: true,
    },
  ],
};
