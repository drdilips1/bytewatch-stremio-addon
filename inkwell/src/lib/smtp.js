// Send to Kindle through any mail server, not just Gmail. Your own server (host, port, security,
// username) when you enter it; else the usual server for your address's provider; else Gmail
// (which is what everyone used before, so their setups keep working).

// Providers' outgoing servers: ssl = encrypted from the start (port 465), starttls = port 587.
const KNOWN = [
  [/^(gmail|googlemail)\.com$/, 'smtp.gmail.com', 465, 'ssl'],
  [/^(outlook|hotmail|live|msn)\.[a-z.]+$/, 'smtp-mail.outlook.com', 587, 'starttls'],
  [/^(yahoo|ymail)\.[a-z.]+$/, 'smtp.mail.yahoo.com', 465, 'ssl'],
  [/^(icloud|me|mac)\.com$/, 'smtp.mail.me.com', 587, 'starttls'],
  [/^(fastmail\.(com|fm)|messagingengine\.com)$/, 'smtp.fastmail.com', 465, 'ssl'],
  [/^zoho\.[a-z.]+$/, 'smtp.zoho.com', 465, 'ssl'],
  [/^(gmx\.[a-z.]+)$/, 'mail.gmx.com', 587, 'starttls'],
  [/^(aol\.com)$/, 'smtp.aol.com', 465, 'ssl'],
  [/^(yandex\.[a-z.]+)$/, 'smtp.yandex.com', 465, 'ssl'],
  [/^(web\.de)$/, 'smtp.web.de', 587, 'starttls'],
];

/** The usual outgoing server for an address, or null when we don't know its provider. */
export function knownServer(email) {
  const domain = String(email || '').split('@')[1]?.toLowerCase() || '';
  const hit = KNOWN.find(([re]) => re.test(domain));
  return hit ? { host: hit[1], port: hit[2], security: hit[3] } : null;
}

/**
 * How to send for a saved sender: { host, port, security: 'ssl' | 'starttls' | 'none', user }.
 * Its own server first, else its provider's, else Gmail.
 */
export function smtpFor(sender = {}) {
  const own = String(sender.host || '').trim();
  const base = own ? { host: own, port: 0, security: '' } : knownServer(sender.email) || { host: 'smtp.gmail.com', port: 465, security: 'ssl' };
  const security = ['ssl', 'starttls', 'none'].includes(sender.security) ? sender.security : base.security || (Number(sender.port) === 465 ? 'ssl' : 'starttls');
  const port = Number(sender.port) || base.port || (security === 'ssl' ? 465 : 587);
  return { host: base.host, port, security, user: String(sender.user || '').trim() || String(sender.email || '').trim() };
}

/** Gmail wants a 16-letter app password; other providers their own (often also an app password). */
export const isGmailServer = (sender) => smtpFor(sender).host === 'smtp.gmail.com';
