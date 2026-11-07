import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './server.js';
import { startScheduler } from './reminders.js';

await connectDb();
console.log(`Connected to MongoDB (database "${config.mongoDb}")`);

createApp().listen(config.port, () => {
  console.log(`YT Reminder API listening on port ${config.port} (frontend: ${config.webUrl})`);
  if (!config.resendApiKey) console.log('RESEND_API_KEY not set: emails will be printed to the console.');
  if (!config.youtubeApiKey) console.log('YOUTUBE_API_KEY not set: only the latest 15 videos per channel are available.');
  if (config.disableScheduler) console.log('Built-in scheduler disabled; call POST /api/cron every few minutes instead.');
  else startScheduler();
});
