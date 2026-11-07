import crypto from 'node:crypto';

let secret = process.env.APP_SECRET;
if (!secret) {
  secret = crypto.randomBytes(32).toString('hex');
  if (process.env.NODE_ENV !== 'test') {
    console.warn('[config] APP_SECRET is not set. Using a random one: email links and logins break on restart.');
  }
}

export const config = {
  port: Number(process.env.PORT || 4000),
  webUrl: (process.env.WEB_URL || 'http://localhost:3000').replace(/\/+$/, ''),
  secret,
  mongoUri: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017',
  mongoDb: process.env.MONGODB_DB || 'yt_reminder',
  resendApiKey: process.env.RESEND_API_KEY || '',
  emailFrom: process.env.EMAIL_FROM || 'YT Reminder <onboarding@resend.dev>',
  youtubeApiKey: process.env.YOUTUBE_API_KEY || '',
  googleClientId: process.env.GOOGLE_CLIENT_ID || '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  defaultTimezone: process.env.DEFAULT_TIMEZONE || 'Asia/Kolkata',
  defaultSendTimes: process.env.DEFAULT_SEND_TIMES || '10:00,20:00',
  minVideoSeconds: Number(process.env.MIN_VIDEO_SECONDS ?? 180),
  cronSecret: process.env.CRON_SECRET || '',
  disableScheduler: process.env.DISABLE_SCHEDULER === '1',
  // If the server was down at send time, still send up to this many minutes late.
  catchupMinutes: 90,
  // Channels are re-synced for new uploads at most this often.
  channelRefreshHours: 12,
};

export const googleEnabled = () => Boolean(config.googleClientId && config.googleClientSecret);
