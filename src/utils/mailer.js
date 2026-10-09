/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Transactional email through Brevo (backend only; credentials never reach the browser). Two transports:
//
//   SMTP  (default when SMTP_HOST/SMTP_USER/SMTP_PASS are set)   smtp-relay.brevo.com:587
//   API   (used when BREVO_API_KEY is set; HTTPS, works where SMTP ports are blocked)
//         POST https://api.brevo.com/v3/smtp/email      header: api-key: <BREVO_API_KEY>
//
// The From address must be a validated sender in your Brevo account, otherwise Brevo refuses the mail.
// Functions here never throw: they resolve { ok, ... } so callers can't be broken by an email
// outage (e.g. a school is still created even if its welcome email fails).
const crypto = require('crypto');

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';

function cfg() {
  const smtp = {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT) || 587,
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
  };
  return {
    apiKey: process.env.BREVO_API_KEY || '',
    smtp,
    // The visible "From": SMTP_FROM / BREVO_SENDER_EMAIL, falling back to the SMTP login.
    senderEmail: process.env.SMTP_FROM || process.env.BREVO_SENDER_EMAIL || smtp.user,
    senderName: process.env.SMTP_FROM_NAME || process.env.BREVO_SENDER_NAME || 'School Management',
    timeoutMs: Number(process.env.SMTP_TIMEOUT_MS || process.env.BREVO_TIMEOUT_MS) || 15000,
  };
}

/** 'smtp' | 'api' | null — SMTP wins when both are configured. */
function transportMode() {
  const c = cfg();
  if (c.smtp.host && c.smtp.user && c.smtp.pass && c.senderEmail) return 'smtp';
  if (c.apiKey && c.senderEmail) return 'api';
  return null;
}

function isConfigured() {
  return transportMode() !== null;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

function redact(s) {
  if (typeof s !== 'string') return s;
  for (const secret of [process.env.BREVO_API_KEY, process.env.SMTP_PASS]) {
    if (secret) s = s.split(secret).join('[REDACTED]');
  }
  return s;
}

function hintFor(status, body) {
  const msg = String(body?.message || '').toLowerCase();
  if (status === 401) return 'Brevo rejected the API key (BREVO_API_KEY is wrong, revoked, or not a v3 API key).';
  if (status === 402) return 'Brevo account has no sending credits left.';
  if (status === 403) return 'Brevo denied the request (IP restriction or account not activated — check Security → Authorized IPs).';
  if (status === 400 && (msg.includes('sender') || msg.includes('domain'))) {
    return `The sender address is not validated in Brevo. Add and verify ${cfg().senderEmail || 'your sender'} under Brevo → Senders, Domains & Dedicated IPs.`;
  }
  if (status === 429) return 'Brevo rate limit reached — try again shortly.';
  return null;
}

/** Sends one email. Resolves { ok, messageId } or { ok:false, code, error, retryable }. */
async function sendEmail(msg) {
  const mode = transportMode();
  if (!mode) {
    return { ok: false, code: 'NOT_CONFIGURED', error: 'Email is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM — or BREVO_API_KEY and BREVO_SENDER_EMAIL).' };
  }
  if (!msg.to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(msg.to)) {
    return { ok: false, code: 'INVALID_RECIPIENT', error: `"${msg.to || ''}" is not a valid email address.` };
  }
  return mode === 'smtp' ? sendViaSmtp(msg) : sendViaApi(msg);
}

let smtpTransport = null;
let smtpKey = '';
function getSmtpTransport(c) {
  const key = `${c.smtp.host}|${c.smtp.port}|${c.smtp.user}|${c.smtp.pass}`;
  if (!smtpTransport || key !== smtpKey) {
    smtpKey = key;
    smtpTransport = require('nodemailer').createTransport({
      host: c.smtp.host, port: c.smtp.port,
      secure: c.smtp.port === 465,        // 465 = implicit TLS; 587/2525 = STARTTLS
      requireTLS: c.smtp.port !== 465,    // never fall back to plain text
      auth: { user: c.smtp.user, pass: c.smtp.pass },
      connectionTimeout: c.timeoutMs, greetingTimeout: c.timeoutMs, socketTimeout: c.timeoutMs,
    });
  }
  return smtpTransport;
}

async function sendViaSmtp({ to, toName, subject, html, text }) {
  const c = cfg();
  try {
    const info = await getSmtpTransport(c).sendMail({
      from: { name: c.senderName, address: c.senderEmail },
      to: toName ? { name: toName, address: to } : to,
      subject, html, ...(text ? { text } : {}),
    });
    console.log('[mailer] accepted (smtp)', JSON.stringify({ to: maskEmail(to), messageId: info.messageId }));
    return { ok: true, messageId: info.messageId };
  } catch (e) {
    // Log the failure only — never the message (it contains the credentials).
    console.error('[mailer] smtp error', redact(JSON.stringify({ to: maskEmail(to), code: e.code, responseCode: e.responseCode, message: e.message })));
    let error = redact(e.message);
    if (e.code === 'EAUTH') error = 'Brevo SMTP rejected the login (SMTP_USER / SMTP_PASS are wrong or the SMTP key was revoked).';
    else if (['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'ECONNREFUSED', 'ENOTFOUND', 'EDNS'].includes(e.code)) error = `Could not connect to ${c.smtp.host}:${c.smtp.port} (${e.code}). If the app runs on Render's free plan, outbound SMTP ports may be blocked — use BREVO_API_KEY (HTTPS) instead.`;
    else if (e.responseCode >= 500 && /sender|from|domain|authenticat/i.test(String(e.response))) error = `Brevo refused the sender address. Verify ${c.senderEmail} under Brevo → Senders, Domains & Dedicated IPs. (${e.response})`;
    return { ok: false, code: e.code || (e.responseCode ? `SMTP_${e.responseCode}` : 'SMTP_ERROR'), error, retryable: ['ETIMEDOUT', 'ESOCKET', 'ECONNECTION'].includes(e.code) || e.responseCode >= 400 && e.responseCode < 500 };
  }
}

async function sendViaApi({ to, toName, subject, html, text }) {
  const c = cfg();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), c.timeoutMs);
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: { 'api-key': c.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: c.senderEmail, name: c.senderName },
        to: [{ email: to, ...(toName ? { name: toName } : {}) }],
        subject, htmlContent: html, ...(text ? { textContent: text } : {}),
      }),
      signal: ctrl.signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      // Log the response only — the request body contains the credentials.
      console.error('[mailer] send failed', redact(JSON.stringify({ to: maskEmail(to), http: res.status, code: body.code, message: body.message })));
      return {
        ok: false, code: body.code || `HTTP_${res.status}`,
        error: hintFor(res.status, body) || body.message || `Brevo returned HTTP ${res.status}`,
        retryable: res.status === 429 || res.status >= 500,
      };
    }
    console.log('[mailer] accepted', JSON.stringify({ to: maskEmail(to), messageId: body.messageId }));
    return { ok: true, messageId: body.messageId };
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    console.error('[mailer] request error', redact(e.message));
    return {
      ok: false, code: timedOut ? 'TIMEOUT' : 'NETWORK', retryable: true,
      error: timedOut ? 'Timed out contacting Brevo.' : `Could not reach Brevo: ${redact(e.message)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function maskEmail(e) {
  const [u, d] = String(e).split('@');
  return `${(u || '').slice(0, 2)}***@${d || ''}`;
}

/** Readable temporary password: 12 chars, no look-alikes (0/O, 1/l/I), always upper + lower + digit + symbol. */
function generateTempPassword() {
  const U = 'ABCDEFGHJKLMNPQRSTUVWXYZ', L = 'abcdefghijkmnopqrstuvwxyz', D = '23456789', S = '@#$%&*?';
  const pick = (set) => set[crypto.randomInt(set.length)];
  const chars = [pick(U), pick(U), pick(L), pick(L), pick(L), pick(L), pick(D), pick(D), pick(D), pick(S), pick(U + L), pick(U + L)];
  for (let i = chars.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; }
  return chars.join('');
}

/** The new-school welcome email: platform URL + the administrator's first-login email and password. */
function sendSchoolCredentialsEmail({ to, adminName, schoolName, loginUrl, tempPassword }) {
  const subject = `Your ${schoolName} account is ready`;
  const text = [
    `Hello ${adminName},`,
    '',
    `Your school "${schoolName}" has been set up on the school management platform.`,
    '',
    `Platform URL: ${loginUrl}`,
    `Email (username): ${to}`,
    `Temporary password: ${tempPassword}`,
    '',
    'For your security, you will be asked to choose a new password the first time you sign in.',
    'Do not share this email with anyone.',
  ].join('\n');

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px"><tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e2e8f0">
    <tr><td style="background:#4f46e5;padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold">Welcome to your school platform</td></tr>
    <tr><td style="padding:28px">
      <p style="margin:0 0 14px;font-size:15px">Hello ${esc(adminName)},</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.5">Your school <strong>${esc(schoolName)}</strong> has been set up. Use the details below to sign in for the first time.</p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px">
        <tr><td style="padding:14px 16px;font-size:13px;color:#64748b">Platform URL</td></tr>
        <tr><td style="padding:0 16px 12px;font-size:15px"><a href="${esc(loginUrl)}" style="color:#4f46e5">${esc(loginUrl)}</a></td></tr>
        <tr><td style="padding:0 16px;font-size:13px;color:#64748b">Email (username)</td></tr>
        <tr><td style="padding:0 16px 12px;font-size:15px;font-weight:bold">${esc(to)}</td></tr>
        <tr><td style="padding:0 16px;font-size:13px;color:#64748b">Temporary password</td></tr>
        <tr><td style="padding:0 16px 16px;font-size:17px;font-weight:bold;font-family:Consolas,Menlo,monospace;letter-spacing:1px">${esc(tempPassword)}</td></tr>
      </table>
      <p style="text-align:center;margin:24px 0"><a href="${esc(loginUrl)}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:bold;font-size:15px">Sign in now</a></p>
      <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#475569"><strong>Important:</strong> you will be asked to choose a new password the first time you sign in. Please do it straight away.</p>
      <p style="margin:0;font-size:12px;line-height:1.5;color:#94a3b8">Do not share this email with anyone. If you were not expecting it, please ignore it.</p>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  return sendEmail({ to, toName: adminName, subject, html, text });
}

module.exports = { isConfigured, sendEmail, sendSchoolCredentialsEmail, generateTempPassword };
