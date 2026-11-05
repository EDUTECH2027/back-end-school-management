/*
 * Copyright (c) 2026 [COMPANY LEGAL NAME]. All rights reserved.
 * Proprietary and confidential. Unauthorized copying, distribution or
 * modification of this file, via any medium, is strictly prohibited.
 */
// Tiny in-process TTL cache for the two lookups every authenticated request used to make against
// the (remote) database: the subject's token_version and the school's status. A page fires several
// API calls at once, so a few seconds of caching removes most of those round trips. Anything that
// changes a token_version evicts its entry immediately (see tokens.bumpTokenVersion), so a
// "log out everywhere" still takes effect at once; school status changes are seen within the TTL.
const SUBJECT_TTL_MS = 5000;
const SCHOOL_TTL_MS = 15000;
const MAX_ENTRIES = 5000;

const subjects = new Map(); // key -> { value, exp }
const schools = new Map();

const fresh = (map, key) => {
  const hit = map.get(key);
  if (hit && hit.exp > Date.now()) return hit.value;
  if (hit) map.delete(key);
  return undefined;
};
const put = (map, key, value, ttl) => {
  if (map.size >= MAX_ENTRIES) map.clear();
  map.set(key, { value, exp: Date.now() + ttl });
};

const subjectKey = (scope, schoolId, id) => `${scope}:${schoolId || ''}:${id}`;

// school status, through the cache (undefined means "not cached"; null is a cached "no such school")
async function schoolStatus(platformClient, id) {
  let school = fresh(schools, id);
  if (school === undefined) {
    school = await platformClient.school.findUnique({ where: { id }, select: { status: true } });
    put(schools, id, school, SCHOOL_TTL_MS);
  }
  return school;
}

module.exports = {
  schoolStatus,
  getSubject: (scope, schoolId, id) => fresh(subjects, subjectKey(scope, schoolId, id)),
  setSubject: (scope, schoolId, id, value) => put(subjects, subjectKey(scope, schoolId, id), value, SUBJECT_TTL_MS),
  evictSubject: (scope, schoolId, id) => subjects.delete(subjectKey(scope, schoolId, id)),
  getSchool: (id) => fresh(schools, id),
  setSchool: (id, value) => put(schools, id, value, SCHOOL_TTL_MS),
};
