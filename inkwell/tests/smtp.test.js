// Send to Kindle through any mail server: which server a saved sender uses.
import { describe, it, expect } from 'vitest';
import { smtpFor, knownServer, isGmailServer } from '../src/lib/smtp.js';

describe('smtpFor', () => {
  it('a Gmail sender saved before (no server) still goes through Gmail', () => {
    expect(smtpFor({ email: 'me@gmail.com', password: 'x' })).toEqual({ host: 'smtp.gmail.com', port: 465, security: 'ssl', user: 'me@gmail.com' });
    expect(isGmailServer({ email: 'me@gmail.com' })).toBe(true);
  });

  it("an address from a known provider uses that provider's server", () => {
    expect(smtpFor({ email: 'a@outlook.com' })).toMatchObject({ host: 'smtp-mail.outlook.com', port: 587, security: 'starttls' });
    expect(smtpFor({ email: 'a@icloud.com' })).toMatchObject({ host: 'smtp.mail.me.com', port: 587 });
    expect(knownServer('a@example.org')).toBe(null);
  });

  it('your own server wins, with the port and security you give (or sensible ones)', () => {
    expect(smtpFor({ email: 'me@mydomain.org', host: 'mail.mydomain.org', port: 2525, security: 'starttls', user: 'me' })).toEqual({ host: 'mail.mydomain.org', port: 2525, security: 'starttls', user: 'me' });
    expect(smtpFor({ email: 'me@mydomain.org', host: 'mail.mydomain.org' })).toMatchObject({ port: 587, security: 'starttls', user: 'me@mydomain.org' });
    expect(smtpFor({ email: 'me@mydomain.org', host: 'mail.mydomain.org', port: 465 })).toMatchObject({ security: 'ssl' });
  });

  it('an unknown provider and no server: Gmail, as before', () => {
    expect(smtpFor({ email: 'me@example.org' }).host).toBe('smtp.gmail.com');
  });
});
