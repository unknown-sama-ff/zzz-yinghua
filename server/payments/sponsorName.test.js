import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSponsorName, SPONSOR_NAME_MAX, DEFAULT_SPONSOR_NAME } from './sponsorName.js';

test('missing/undefined defaults to Traveler', () => {
  assert.equal(parseSponsorName(undefined), DEFAULT_SPONSOR_NAME);
  assert.equal(parseSponsorName(null), DEFAULT_SPONSOR_NAME);
});

test('empty/whitespace defaults to Traveler', () => {
  assert.equal(parseSponsorName(''), DEFAULT_SPONSOR_NAME);
  assert.equal(parseSponsorName('   '), DEFAULT_SPONSOR_NAME);
});

test('non-string values default to Traveler', () => {
  assert.equal(parseSponsorName(123), DEFAULT_SPONSOR_NAME);
  assert.equal(parseSponsorName(true), DEFAULT_SPONSOR_NAME);
});

test('trims surrounding whitespace', () => {
  assert.equal(parseSponsorName('  小明  '), '小明');
});

test('caps length at SPONSOR_NAME_MAX', () => {
  const long = 'a'.repeat(30);
  const parsed = parseSponsorName(long);
  assert.equal(parsed, 'a'.repeat(SPONSOR_NAME_MAX));
  assert.ok(parsed.length <= SPONSOR_NAME_MAX);
});

test('strips control characters', () => {
  assert.equal(parseSponsorName(`ab${String.fromCharCode(0)}cd`), 'abcd');
  assert.equal(parseSponsorName(`li${String.fromCharCode(10)}ne`), 'line');
});

test('keeps a plain CJK name', () => {
  assert.equal(parseSponsorName('小明'), '小明');
});
