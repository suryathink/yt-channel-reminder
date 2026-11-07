import { config } from './config.js';
import { html, raw } from './html.js';
import { formatDuration } from './time.js';
import { sign } from './tokens.js';

const watchUrl = (id) => `https://www.youtube.com/watch?v=${id}`;
const btn = (href, label, bg, fg = '#ffffff') =>
  html`<a href="${href}" style="display:inline-block;padding:10px 16px;margin:4px 8px 4px 0;border-radius:8px;background:${bg};color:${fg};text-decoration:none;font-weight:600;font-size:14px">${label}</a>`;

export function renderLoginEmail(link) {
  return {
    subject: 'Your YT Reminder sign-in link',
    text: `Sign in to YT Reminder: ${link}\n\nThis link expires in 15 minutes. If you didn't ask for it, ignore this email.`,
    html: html`<div style="font-family:system-ui,sans-serif;max-width:480px;margin:auto;padding:24px;color:#111">
      <h2 style="margin-top:0">Sign in to YT Reminder</h2>
      <p>${btn(link, 'Sign in', '#cc0000')}</p>
      <p style="color:#666;font-size:13px">This link expires in 15 minutes. If you didn't ask for it, ignore this email.</p>
    </div>`.toString(),
  };
}

/**
 * items: [{ channel, video | null, progress: { total, watched } }]
 * slotIndex 0 = the day's first email ("today's pick"); later ones are reminders.
 */
export function renderDailyEmail({ user, items, slotIndex }) {
  const first = slotIndex === 0;
  const withVideo = items.filter((i) => i.video);
  const lead = withVideo[0]?.video;
  const subject = !lead
    ? "You've watched everything on your channels 🎉"
    : first
      ? `📺 Today's video: ${lead.title}`
      : `⏰ Reminder: have you watched "${lead.title}" yet?`;

  const intro = first
    ? "Here's today's video. Block out some time, watch it properly, and learn something new today."
    : "Quick evening reminder: today's video is still waiting for you. Even 30 focused minutes counts.";

  const unsubscribe = `${config.appUrl}/u/${sign({ a: 'u', u: user.id })}`;
  const settings = `${config.appUrl}/dashboard`;
  const notionLine = user.notion_url
    ? html`Write it up in <a href="${user.notion_url}" style="color:#cc0000">your Notion notes</a>.`
    : html`Create a note in Notion (or wherever you keep notes).`;

  const blocks = items.map(({ channel, video, progress }) => {
    if (!video) {
      return html`<div style="border:1px solid #e5e5e5;border-radius:12px;padding:16px;margin:16px 0">
        <strong>${channel.title}</strong>: you've watched all ${progress.total} videos. Nice work! 🎉
      </div>`;
    }
    const watchedLink = `${config.appUrl}/w/${sign({ a: 'w', u: user.id, v: video.video_id })}`;
    return html`<div style="border:1px solid #e5e5e5;border-radius:12px;padding:16px;margin:16px 0">
      <div style="color:#666;font-size:13px;margin-bottom:8px">${channel.title}${video.duration_seconds ? ` · ${formatDuration(video.duration_seconds)}` : ''}</div>
      ${video.thumbnail ? html`<a href="${watchUrl(video.video_id)}"><img src="${video.thumbnail}" alt="" width="100%" style="max-width:480px;border-radius:8px;display:block"></a>` : ''}
      <h3 style="margin:12px 0 8px;font-size:18px"><a href="${watchUrl(video.video_id)}" style="color:#111;text-decoration:none">${video.title}</a></h3>
      <div>${btn(watchUrl(video.video_id), '▶ Watch on YouTube', '#cc0000')}${btn(watchedLink, "✓ I've already watched this", '#f1f1f1', '#111')}</div>
      <div style="color:#888;font-size:12px;margin-top:8px">Progress: ${progress.watched || 0} of ${progress.total} videos watched</div>
    </div>`;
  });

  const body = html`<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:auto;padding:24px;color:#111;line-height:1.5">
    <p style="font-size:16px">${intro}</p>
    ${blocks}
    ${lead ? html`<div style="background:#fff8e1;border-radius:12px;padding:16px;margin:16px 0">
      <strong>📝 After watching, take notes.</strong> ${notionLine}
      Write down the key concepts, how the system works under the hood, the trade-offs mentioned, and one thing you'd like to try yourself.
      Writing it down is what makes it stick.
    </div>` : ''}
    <p style="color:#888;font-size:12px;margin-top:24px">
      Already watched it? Use the "I've already watched this" button and it won't be suggested again.<br>
      <a href="${settings}" style="color:#888">Settings &amp; channels</a> · <a href="${unsubscribe}" style="color:#888">Pause these emails</a>
    </p>
  </div>`;

  const text = [
    intro, '',
    ...items.flatMap(({ channel, video, progress }) => video
      ? [`${channel.title}: ${video.title}${video.duration_seconds ? ` (${formatDuration(video.duration_seconds)})` : ''}`,
        `Watch: ${watchUrl(video.video_id)}`,
        `Already watched it? ${config.appUrl}/w/${sign({ a: 'w', u: user.id, v: video.video_id })}`,
        `Progress: ${progress.watched || 0}/${progress.total}`, '']
      : [`${channel.title}: you've watched everything!`, '']),
    lead ? `After watching, create a note in Notion${user.notion_url ? ` (${user.notion_url})` : ''}: key concepts, trade-offs, and one thing to try yourself.` : '',
    '', `Settings: ${settings}`, `Pause emails: ${unsubscribe}`,
  ].join('\n');

  return { subject, html: body.toString(), text, hasVideo: Boolean(lead) };
}

