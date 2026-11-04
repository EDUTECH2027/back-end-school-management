const test = require('node:test');
const assert = require('node:assert/strict');
const { gradeFor } = require('../src/utils/grading');

// Marks are out of 20: the bands are the old 0–100 bands divided by 5.
test('grade bands on the 0–20 scale', () => {
  const g = (n) => gradeFor(n).grade;
  assert.equal(g(20), 'A+'); assert.equal(g(18), 'A+'); assert.equal(g(17.9), 'A');
  assert.equal(g(16), 'A'); assert.equal(g(15.9), 'B');
  assert.equal(g(14), 'B'); assert.equal(g(13.9), 'C');
  assert.equal(g(12), 'C'); assert.equal(g(11.9), 'D');
  assert.equal(g(10), 'D'); assert.equal(g(9.9), 'F'); assert.equal(g(0), 'F');
});
