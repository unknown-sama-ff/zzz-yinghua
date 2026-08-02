export const SPONSOR_NAME_MAX = 20;
export const DEFAULT_SPONSOR_NAME = 'Traveler';

// Built from char codes (rather than escape sequences) to keep the source
// file free of literal control characters. Matches NUL-US and DEL.
const CONTROL_CHAR_RE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  'g',
);

/** Accept only string names; strip control chars, trim, cap length; default 'Traveler' when missing/invalid. Never throws. */
export function parseSponsorName(value) {
  if (typeof value !== 'string') return DEFAULT_SPONSOR_NAME;
  const text = value.replace(CONTROL_CHAR_RE, '').trim();
  return text ? text.slice(0, SPONSOR_NAME_MAX) : DEFAULT_SPONSOR_NAME;
}
