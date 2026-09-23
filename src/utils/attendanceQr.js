// Shared helpers for the teacher QR attendance feature.

const crypto = require('crypto');

/** Opaque random token encoded in the QR image. Not hashed at rest — see the
 * AttendanceQrCode model comment in schema.prisma for why that's fine here. */
function generateToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/** "YYYY-MM" for a given date (defaults to now), server-local. */
function monthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Last instant of the month identified by a "YYYY-MM" key. */
function endOfMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m, 0, 23, 59, 59, 999); // day 0 of next month = last day of this one
}

/** "YYYY-MM-DD" for a given date, server-local. */
function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "HH:MM" for a given date, server-local, zero-padded. */
function timeKey(d = new Date()) {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 'present' (On Time) if the scan's HH:MM is at-or-before the threshold,
 * 'late' otherwise. Zero-padded HH:MM strings compare correctly lexically.
 */
function classifyArrival(scanDate, thresholdHHMM) {
  return timeKey(scanDate) <= thresholdHHMM ? 'present' : 'late';
}

module.exports = { generateToken, monthKey, endOfMonth, dateKey, timeKey, classifyArrival };
