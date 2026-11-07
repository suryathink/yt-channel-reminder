import { config } from './config.js';

let transport = async (message) => {
  if (!config.resendApiKey) {
    console.log(`\n[email:dev] To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}\n`);
    return { id: 'dev' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.emailFrom, ...message }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend error ${res.status}: ${body.message || JSON.stringify(body)}`);
  return body;
};

/** For tests: replace how emails are delivered. */
export const setTransport = (fn) => { transport = fn; };

export const sendEmail = (message) => transport(message);
