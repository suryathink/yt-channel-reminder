import { googleEnabled } from './config.js';
import { html, raw } from './html.js';
import { formatDuration } from './time.js';

const CSS = `
:root{--bg:#fafafa;--card:#fff;--text:#111;--muted:#666;--line:#e6e6e6;--accent:#cc0000;--soft:#f3f3f3}
@media (prefers-color-scheme:dark){:root{--bg:#121212;--card:#1d1d1d;--text:#eee;--muted:#9a9a9a;--line:#333;--soft:#2a2a2a}}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:var(--bg);color:var(--text)}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}
header{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:24px}
header a.brand{font-weight:700;font-size:18px;color:var(--text);text-decoration:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px;margin:16px 0}
h1{font-size:28px;margin:8px 0}h2{font-size:18px;margin:0 0 12px}
.muted{color:var(--muted)}.small{font-size:13px}
input,select{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--text);font:inherit}
label{display:block;font-weight:600;margin:12px 0 4px}
button,.btn{display:inline-block;padding:10px 16px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;text-decoration:none}
button.secondary,.btn.secondary{background:var(--soft);color:var(--text)}
button.link{background:none;color:var(--muted);padding:0;font-weight:400;text-decoration:underline}
form.inline{display:inline}.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.row>input{flex:1;min-width:200px}
.flash{padding:12px 16px;border-radius:10px;margin:16px 0;background:#e8f5e9;color:#1b5e20}.flash.error{background:#fdecea;color:#8a1c1c}
.video{display:flex;gap:16px;flex-wrap:wrap}.video img{width:220px;max-width:100%;border-radius:10px}
.video .info{flex:1;min-width:220px}
.bar{height:6px;background:var(--soft);border-radius:4px;overflow:hidden;margin-top:6px}.bar>i{display:block;height:100%;background:var(--accent)}
ul.plain{list-style:none;padding:0;margin:0}ul.plain li{padding:8px 0;border-top:1px solid var(--line)}ul.plain li:first-child{border-top:0}
.ch{display:flex;gap:12px;align-items:center}.ch img{width:40px;height:40px;border-radius:50%}
`;

export function layout(title, body, { user, flash } = {}) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>${raw(CSS)}</style></head><body><main>
<header><a class="brand" href="/">📺 YT Reminder</a>
${user ? html`<div class="row small"><span class="muted">${user.email}</span>
  <form class="inline" method="post" action="/logout"><button class="link">Sign out</button></form></div>` : ''}
</header>
${flash ? html`<div class="flash ${flash.error ? 'error' : ''}">${flash.error || flash.ok}</div>` : ''}
${body}
</main></body></html>`.toString();
}

export const landingPage = (flash) => layout('YT Reminder', html`
<h1>Never forget to learn from your favourite YouTube channels.</h1>
<p class="muted">Add a channel (like Hussein Nasser's backend engineering videos). Every day you get an email with one random video you haven't watched,
in the morning, plus an evening reminder. Mark it as watched in one click and it's never suggested again.</p>
<div class="card"><h2>Sign in or create an account</h2>
<form method="post" action="/login" class="row"><input type="email" name="email" placeholder="you@example.com" required autofocus>
<button>Email me a sign-in link</button></form>
<p class="small muted">No password. We email you a link, and reminders go to this address.</p></div>`, { flash });

export const checkInboxPage = (email) => layout('Check your inbox', html`
<div class="card"><h2>Check your inbox 📬</h2><p>We sent a sign-in link to <strong>${email}</strong>. It expires in 15 minutes.</p>
<p class="small muted">Not there? Check spam, or <a href="/">try again</a>.</p></div>`);

export const confirmPage = (title, text, action, buttonLabel, user) => layout(title, html`
<div class="card"><h2>${title}</h2><p>${text}</p>
<form method="post" action="${action}"><button>${buttonLabel}</button></form></div>`, { user });

export const messagePage = (title, text, user) => layout(title, html`
<div class="card"><h2>${title}</h2><p>${text}</p><p><a class="btn secondary" href="/dashboard">Go to dashboard</a></p></div>`, { user });

const pct = (p) => (p.total ? Math.round(((p.watched || 0) / p.total) * 100) : 0);

export function dashboardPage({ user, channels, picks, recent, timezones, flash }) {
  const yt = (id) => `https://www.youtube.com/watch?v=${id}`;
  const today = picks.length ? html`<div class="card"><h2>Today's videos</h2>
    ${picks.map(({ channel, video, progress }) => video ? html`
      <div class="video" style="margin-bottom:16px">
        ${video.thumbnail ? html`<a href="${yt(video.video_id)}" target="_blank" rel="noopener"><img src="${video.thumbnail}" alt=""></a>` : ''}
        <div class="info"><div class="small muted">${channel.title}${video.duration_seconds ? ` · ${formatDuration(video.duration_seconds)}` : ''}</div>
          <div style="font-weight:600;margin:4px 0 10px">${video.title}</div>
          <div class="row"><a class="btn" href="${yt(video.video_id)}" target="_blank" rel="noopener">▶ Watch</a>
            <form class="inline" method="post" action="/videos/${video.video_id}/watched"><button class="secondary">✓ Mark as watched</button></form></div>
          <div class="small muted" style="margin-top:6px">${progress.watched || 0} / ${progress.total} watched</div></div>
      </div>` : html`<p><strong>${channel.title}</strong>: ${progress.total ? "you've watched everything 🎉" : 'no videos found yet.'}</p>`)}
  </div>` : '';

  const channelList = html`<div class="card"><h2>Your channels</h2>
    ${channels.length ? html`<ul class="plain">${channels.map(({ channel, progress }) => html`<li>
      <div class="ch">${channel.thumbnail ? html`<img src="${channel.thumbnail}" alt="">` : ''}
        <div style="flex:1"><a href="https://www.youtube.com/channel/${channel.channel_id}" target="_blank" rel="noopener"><strong>${channel.title}</strong></a>
          <div class="small muted">${progress.watched || 0} of ${progress.total} videos watched (${pct(progress)}%)</div>
          <div class="bar"><i style="width:${pct(progress)}%"></i></div></div>
        <form class="inline" method="post" action="/channels/${channel.channel_id}/sync"><button class="link small">Refresh</button></form>
        <form class="inline" method="post" action="/channels/${channel.channel_id}/delete" onsubmit="return confirm('Remove this channel?')"><button class="link small">Remove</button></form>
      </div></li>`)}</ul>` : html`<p class="muted">No channels yet. Add your first one below.</p>`}
    <form method="post" action="/channels" class="row" style="margin-top:12px">
      <input name="channel" placeholder="https://www.youtube.com/@hnasr" required>
      <button>Add channel</button></form>
    <p class="small muted">Paste a channel link, an @handle, or a channel ID. The first sync can take a few seconds for big channels.</p></div>`;

  const settings = html`<div class="card"><h2>Email settings</h2>
    <form method="post" action="/settings">
      <label for="tz">Time zone</label>
      <select id="tz" name="timezone">${(timezones.includes(user.timezone) ? timezones : [user.timezone, ...timezones]).map((tz) => html`<option value="${tz}" ${tz === user.timezone ? raw('selected') : ''}>${tz}</option>`)}</select>
      <label for="times">Send times (24h, comma separated)</label>
      <input id="times" name="send_times" value="${user.send_times.split(',').join(', ')}" placeholder="10:00, 20:00">
      <p class="small muted">The first time each day picks a new video. Later times are reminders for the same video, or a new one if you've already watched it.</p>
      <label for="notion">Notion notes page (optional)</label>
      <input id="notion" name="notion_url" type="url" value="${user.notion_url || ''}" placeholder="https://www.notion.so/My-learning-notes-…">
      <label style="display:flex;gap:8px;align-items:center;font-weight:400"><input type="checkbox" name="paused" value="1" style="width:auto" ${user.paused ? raw('checked') : ''}> Pause all emails</label>
      <div class="row" style="margin-top:12px"><button>Save settings</button></div>
    </form>
    <form method="post" action="/send-now" style="margin-top:12px"><button class="secondary">Send me today's email now</button></form>
    <p class="small muted">Emails go to <strong>${user.email}</strong>.</p></div>`;

  const youtube = googleEnabled() ? html`<div class="card"><h2>YouTube account</h2>
    ${user.google_refresh_token
      ? html`<p>✅ Connected. Videos you mark as watched are added to a private <strong>"Watched ✓ (YT Reminder)"</strong> playlist on your YouTube account.</p>
        <form method="post" action="/auth/google/disconnect"><button class="secondary">Disconnect YouTube</button></form>`
      : html`<p class="muted">Optional. YouTube doesn't let apps change your watch history, so when you mark a video as watched we add it to a private
        "Watched" playlist on your YouTube account instead.</p><a class="btn secondary" href="/auth/google/start">Connect YouTube</a>`}
  </div>` : '';

  const history = recent.length ? html`<div class="card"><h2>Recently watched</h2><ul class="plain">
    ${recent.map((v) => html`<li class="row" style="justify-content:space-between"><span><a href="${yt(v.video_id)}" target="_blank" rel="noopener">${v.title}</a>
      <span class="small muted">· ${v.watched_at.slice(0, 10)}</span></span>
      <form class="inline" method="post" action="/videos/${v.video_id}/unwatch"><button class="link small">Undo</button></form></li>`)}
  </ul></div>` : '';

  return layout('Dashboard · YT Reminder', html`${today}${channelList}${settings}${youtube}${history}`, { user, flash });
}
