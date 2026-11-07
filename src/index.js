import { config } from './config.js';
import { createApp } from './server.js';
import { startScheduler } from './reminders.js';

createApp().listen(config.port, () => {
  console.log(`YT Reminder running at ${config.appUrl} (port ${config.port})`);
  if (!config.resendApiKey) console.log('RESEND_API_KEY not set: emails will be printed to the console.');
  if (!config.youtubeApiKey) console.log('YOUTUBE_API_KEY not set: only the latest 15 videos per channel are available.');
  if (config.disableScheduler) console.log('Built-in scheduler disabled; call /cron every few minutes instead.');
  else startScheduler();
});
