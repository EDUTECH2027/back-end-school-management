/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Matches class names typed in a spreadsheet ("FORM 1", "form one", "Form 1 A", "6ème A")
// to the school's real classes, creating the missing ones, so every imported student
// lands in the right classroom.
const { v4: uuid } = require('uuid');

const WORD_NUMBERS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7,
};

function stripDiacritics(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// "FORM ONE" / "Form 1" / "form-1" / "Form1" → "form1";  "Form 1 A" → "form1a";  "6ème A" → "6emea"
function classKey(name) {
  let s = stripDiacritics(String(name || '').toLowerCase());
  s = s.replace(/\b(one|two|three|four|five|six|seven|une|un|deux|trois|quatre|cinq|sept)\b/g, w => String(WORD_NUMBERS[w]));
  s = s.replace(/\bclasse?\b|\bsalle\b|\broom\b/g, ' ');
  return s.replace(/[^a-z0-9]/g, '');
}

// ALL-CAPS from spreadsheets ("FORM 1") → "Form 1", but short acronyms ("USS", "LSA") stay as they are.
// Mixed-case input is kept as typed.
function displayName(raw) {
  const s = String(raw || '').trim().replace(/\s+/g, ' ');
  if (s && s === s.toUpperCase()) {
    return s.replace(/\p{L}{4,}/gu, w => w[0] + w.slice(1).toLowerCase());
  }
  return s;
}

// Optimal-string-alignment distance: a swapped pair of letters ("FOMR" vs "FORM") counts as 1.
function editDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/**
 * Resolves each distinct class label to a class row, creating missing classes.
 * @param db        tenant Prisma client (or transaction)
 * @param labels    iterable of raw class names from the file
 * @param opts.createMissing  create classes that don't exist (default true)
 * @returns { byKey: Map<classKey, {id,name,grade_level_name}>, created: string[], unmatched: string[] }
 */
async function resolveClasses(db, labels, { createMissing = true } = {}) {
  const classes = await db.class.findMany({ select: { id: true, name: true, grade_level_name: true } });
  const levels = await db.gradeLevel.findMany({ select: { id: true, name: true } });
  const byKey = new Map(classes.map(c => [classKey(c.name), c]));
  const created = [], unmatched = [];

  // Grade level whose key is a prefix of the class key, remainder being only a section letter ("form1" → "form1a").
  const levelFor = (key) => {
    let best = null;
    for (const l of levels) {
      const lk = classKey(l.name);
      if (lk && key.startsWith(lk) && /^[a-z]{0,2}$/.test(key.slice(lk.length)) && (!best || lk.length > classKey(best.name).length)) best = l;
    }
    return best;
  };

  // Most common spelling first, so a one-off typo ("FOMR 3") is folded into the real class ("FORM 3")
  // instead of becoming a class of its own.
  const tally = new Map(); // key → { raw, n }
  for (const raw of labels) {
    const key = classKey(raw);
    if (!key) continue;
    const t = tally.get(key);
    if (t) t.n++; else tally.set(key, { raw, n: 1 });
  }
  const seen = new Map([...tally].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => [k, v.raw]));

  for (const [key, raw] of seen) {
    if (byKey.has(key)) continue;
    // A single character ("Y") is junk, not a classroom.
    if (key.length < 2) { unmatched.push(displayName(raw)); continue; }
    // One typo away from a class we already know (same digits required, so "Form 1" never merges with "Form 2").
    if (key.length >= 5) {
      const digits = key.replace(/\D/g, '');
      const near = [...byKey.keys()].find(k => k.replace(/\D/g, '') === digits
        && !k.startsWith(key) && !key.startsWith(k) // "form1" vs "form1a" is a section letter, not a typo
        && editDistance(k, key) <= 1);
      if (near) { byKey.set(key, byKey.get(near)); continue; }
    }
    if (!createMissing) { unmatched.push(displayName(raw)); continue; }
    const name = displayName(raw);
    const level = levelFor(key);
    try {
      const row = await db.class.create({
        data: {
          id: uuid(), name, capacity: 40, enrolled: 0,
          grade_level_id: level?.id || null, grade_level_name: level?.name || null,
        },
        select: { id: true, name: true, grade_level_name: true },
      });
      byKey.set(key, row);
      created.push(row.name);
    } catch (e) {
      // Unique-name race or a different spelling of an existing name: re-read before giving up.
      const existing = await db.class.findFirst({ where: { name: { equals: name, mode: 'insensitive' } }, select: { id: true, name: true, grade_level_name: true } });
      if (existing) byKey.set(key, existing); else unmatched.push(name);
    }
  }
  return { byKey, created, unmatched };
}

module.exports = { classKey, displayName, resolveClasses };
