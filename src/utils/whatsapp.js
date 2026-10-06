/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Official Meta WhatsApp Cloud API client (direct to graph.facebook.com — no
// third-party BSP). Backend only: the access token never reaches the frontend.
//
//   POST https://graph.facebook.com/{version}/{phone-number-id}/messages
//   Authorization: Bearer {access-token}
//
// Business-initiated messages (no prior user message in the last 24h) MUST be
// pre-approved templates. See docs/WHATSAPP_SETUP.md for the template to create.

const GRAPH_BASE = 'https://graph.facebook.com';

function cfg() {
  return {
    token: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    wabaId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '',
    version: process.env.WHATSAPP_API_VERSION || 'v25.0',
    template: process.env.WHATSAPP_TEMPLATE_CREDENTIALS || 'school_admin_activation',
    language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'en',
    defaultCountry: (process.env.WHATSAPP_DEFAULT_COUNTRY_CODE || '237').replace(/\D/g, ''),
    timeoutMs: Number(process.env.WHATSAPP_TIMEOUT_MS) || 15000,
  };
}

function isConfigured() {
  const c = cfg();
  return Boolean(c.token && c.phoneNumberId);
}

/**
 * Normalise a phone number to E.164 digits (no '+', as Meta accepts either).
 * Accepts "+237 6 71 23 45 67", "00237671234567", "237671234567", "671234567".
 * Numbers without +/00 are assumed to be national numbers in the default country
 * (Cameroon, 237). Cameroon numbers must be 9 national digits.
 * Returns { ok, number?, error? }.
 */
function normalizePhone(raw) {
  if (!raw || typeof raw !== 'string') return { ok: false, error: 'Phone number is required' };
  const c = cfg();
  let s = raw.trim().replace(/[\s().-]/g, '');
  let international = false;
  if (s.startsWith('+')) { international = true; s = s.slice(1); }
  else if (s.startsWith('00')) { international = true; s = s.slice(2); }
  if (!/^\d+$/.test(s)) return { ok: false, error: 'Phone number may only contain digits, spaces and a leading +' };

  if (!international) {
    if (s.startsWith(c.defaultCountry) && s.length === c.defaultCountry.length + 9) {
      // already includes the country code without '+'
    } else {
      s = s.replace(/^0+/, '');
      s = c.defaultCountry + s;
    }
  }
  if (s.startsWith('237') && !/^237[2368]\d{8}$/.test(s)) {
    return { ok: false, error: 'Invalid Cameroon number: expected +237 followed by 9 digits (e.g. +237 6XX XX XX XX)' };
  }
  if (s.length < 8 || s.length > 15) return { ok: false, error: 'Phone number length is invalid (E.164 allows 8–15 digits)' };
  return { ok: true, number: s };
}

// Map Meta error codes to a short, operator-friendly explanation.
const ERROR_HINTS = {
  190: 'Access token is invalid or expired — generate a new (system-user) token.',
  100: 'Invalid parameter in the request (check phone-number ID / template payload).',
  131008: 'A required parameter is missing.',
  131009: 'A parameter value is invalid.',
  131026: 'Recipient is not a WhatsApp user or cannot receive this message.',
  131030: 'Recipient number is not in the allowed list (test numbers only while the app is in development).',
  131047: 'Re-engagement window expired — a template message is required.',
  131048: 'Spam rate limit hit for this sender.',
  131051: 'Unsupported message type.',
  132000: 'Template variable count does not match the approved template.',
  132001: 'Template does not exist / is not approved in this language.',
  132005: 'Template text is too long after variable substitution.',
  132012: 'Template parameter format mismatch.',
  132015: 'Template is paused by Meta (low quality).',
  132016: 'Template is disabled by Meta.',
  130429: 'Throughput limit reached — retry shortly.',
  80007: 'WhatsApp Business account rate limit reached.',
  133010: 'Sender phone number is not registered with the Cloud API.',
};
const RETRYABLE = new Set([4, 130429, 80007, 131048, 2, 1]);

function redact(s) {
  const t = process.env.WHATSAPP_ACCESS_TOKEN;
  return t && typeof s === 'string' ? s.split(t).join('[REDACTED]') : s;
}

/**
 * Send an approved template message. `bodyParams` are positional {{1}}..{{n}}.
 * Never throws; resolves { ok, messageId?, status?, code?, error?, retryable?, fbtraceId? }.
 */
async function sendTemplate({ to, template, language, bodyParams = [] }) {
  const c = cfg();
  if (!isConfigured()) {
    return { ok: false, code: 'NOT_CONFIGURED', error: 'WhatsApp is not configured (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID missing)' };
  }
  const phone = normalizePhone(to);
  if (!phone.ok) return { ok: false, code: 'INVALID_PHONE', error: phone.error };

  const body = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: phone.number,
    type: 'template',
    template: {
      name: template || c.template,
      language: { code: language || c.language },
      components: bodyParams.length
        ? [{ type: 'body', parameters: bodyParams.map(text => ({ type: 'text', text: String(text) })) }]
        : [],
    },
  };

  const url = `${GRAPH_BASE}/${c.version}/${c.phoneNumberId}/messages`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), c.timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = await res.json().catch(() => ({}));

    if (!res.ok || json.error) {
      const e = json.error || {};
      const detail = e.error_data?.details || e.message || `HTTP ${res.status}`;
      const hint = ERROR_HINTS[e.code];
      // Log the response, never the request body (it contains the password) or token.
      console.error('[whatsapp] send failed', redact(JSON.stringify({
        to: `***${phone.number.slice(-4)}`, template: body.template.name, http: res.status,
        code: e.code, subcode: e.error_subcode, details: detail, fbtrace_id: e.fbtrace_id,
      })));
      return {
        ok: false, code: e.code ?? `HTTP_${res.status}`, fbtraceId: e.fbtrace_id,
        error: hint ? `${hint} (${detail})` : detail,
        retryable: RETRYABLE.has(e.code) || res.status >= 500,
      };
    }

    const msg = json.messages?.[0] || {};
    console.log('[whatsapp] accepted', JSON.stringify({
      to: `***${phone.number.slice(-4)}`, template: body.template.name, id: msg.id, status: msg.message_status,
    }));
    return { ok: true, messageId: msg.id, status: msg.message_status || 'accepted', to: phone.number };
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    console.error('[whatsapp] request error', redact(e.message));
    return {
      ok: false, code: timedOut ? 'TIMEOUT' : 'NETWORK', retryable: true,
      error: timedOut ? 'Timed out contacting the WhatsApp Cloud API' : `Could not reach the WhatsApp Cloud API: ${redact(e.message)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Template "school_admin_activation" — variables {{1}}..{{4}}, see docs/WHATSAPP_SETUP.md. No password is sent. */
function sendSchoolCredentials({ to, adminName, schoolName, username, activationLink }) {
  return sendTemplate({ to, bodyParams: [adminName, schoolName, username, activationLink] });
}

module.exports = { isConfigured, normalizePhone, sendTemplate, sendSchoolCredentials };
