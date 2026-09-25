const path = require('path');

const DOMAIN_RE = /^(?=.{1,253}$)(?!-)[A-Za-z0-9-]{1,63}(?<!-)(\.(?!-)[A-Za-z0-9-]{1,63}(?<!-))*$/;
const USERNAME_RE = /^[a-z_][a-z0-9_-]{0,31}$/;
const GROUP_RE = /^[a-z_][a-z0-9_-]{0,31}$/;

function isValidDomain(domain) {
  return typeof domain === 'string' && DOMAIN_RE.test(domain);
}

function isValidUsername(name) {
  return typeof name === 'string' && USERNAME_RE.test(name);
}

function isValidGroup(name) {
  return typeof name === 'string' && GROUP_RE.test(name);
}

/**
 * Only allow absolute paths, reject shell metacharacters and traversal.
 */
function isSafePath(p) {
  if (typeof p !== 'string' || !p.length) return false;
  if (!path.isAbsolute(p)) return false;
  if (p.includes('..')) return false;
  if (/[;&|`$<>\\\n]/.test(p)) return false;
  return true;
}

function escapeSqlString(str) {
  return String(str).replace(/'/g, "''").replace(/\\/g, '\\\\');
}

function escapeDebconfValue(str) {
  // debconf-set-selections values are plain text lines; strip newlines/tabs.
  return String(str).replace(/[\r\n\t]/g, '');
}

module.exports = {
  isValidDomain,
  isValidUsername,
  isValidGroup,
  isSafePath,
  escapeSqlString,
  escapeDebconfValue,
};
