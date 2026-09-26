const fs = require('fs');
const path = require('path');
const { getInvokingUser } = require('./autostart');
const apache = require('./apache');

// Vhost groups are only a way to filter the list, not access control.
//  - The groups themselves are shared by every login on the machine.
//  - Which group opens by default, and which sites are hidden, is per login.
const GROUPS_FILE = '/var/lib/lampstand/vhost-groups.json';
const VIEW_FILE_NAME = 'vhost-view.json';
const BUILTIN = ['all', 'ungrouped'];
const MAX_NAME = 40;

function viewFile(user) {
  return path.join(user.home, '.config', 'lampstand', VIEW_FILE_NAME);
}

function isRoot() {
  return typeof process.getuid === 'function' && process.getuid() === 0;
}

function newId() {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }
}

// Sites whose project folder (or document root) this user owns.
function ownedDomains(vhosts, uid) {
  return vhosts
    .filter((v) => {
      try { return fs.statSync(v.projectDir || v.docRoot).uid === uid; } catch (e) { return false; }
    })
    .map((v) => v.domain);
}

// Keeps only well-formed groups of existing sites; a site is in at most one group.
function cleanGroups(groups, domains) {
  const seen = new Set();
  const known = new Set(domains);
  const ids = new Set();
  return (Array.isArray(groups) ? groups : [])
    .filter((g) => g && typeof g.id === 'string' && !BUILTIN.includes(g.id) && !ids.has(g.id)
      && typeof g.name === 'string' && g.name.trim() && ids.add(g.id))
    .map((g) => ({
      id: g.id,
      name: g.name.trim().slice(0, MAX_NAME),
      domains: (Array.isArray(g.domains) ? g.domains : []).filter((d) => {
        if (typeof d !== 'string' || seen.has(d) || !known.has(d)) return false;
        seen.add(d);
        return true;
      }),
    }));
}

function cleanView(view, groups, domains) {
  const ids = [...BUILTIN, ...groups.map((g) => g.id)];
  const known = new Set(domains);
  return {
    defaultFilter: view && ids.includes(view.defaultFilter) ? view.defaultFilter : 'all',
    hidden: [...new Set((view && Array.isArray(view.hidden) ? view.hidden : []).filter((d) => known.has(d)))],
  };
}

function writeGroups(data) {
  fs.mkdirSync(path.dirname(GROUPS_FILE), { recursive: true, mode: 0o755 });
  fs.writeFileSync(GROUPS_FILE, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o644 });
}

function writeView(user, view) {
  const file = viewFile(user);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(view, null, 2)}\n`, { mode: 0o644 });
  // Usually running as root — hand ~/.config/lampstand back to the real user.
  if (isRoot() && user.uid !== 0) {
    [path.dirname(file), file].forEach((p) => { try { fs.chownSync(p, user.uid, user.gid); } catch (e) { /* ignore */ } });
  }
}

async function get() {
  const user = getInvokingUser();
  const vhosts = await apache.listVhosts();
  const domains = vhosts.map((v) => v.domain);

  const stored = readJson(GROUPS_FILE) || {};
  const groups = cleanGroups(stored.groups, domains);
  const seededUsers = Array.isArray(stored.seededUsers) ? stored.seededUsers : [];
  let view = readJson(viewFile(user));

  // The first time each login opens Lampstand (as root), give them a group
  // named after them with the not-yet-grouped sites in folders they own. It's
  // an ordinary group afterwards — renaming or deleting it is fine, and it
  // isn't recreated.
  if (isRoot() && !seededUsers.includes(user.name)) {
    const grouped = new Set(groups.flatMap((g) => g.domains));
    const group = { id: newId(), name: user.name, domains: ownedDomains(vhosts, user.uid).filter((d) => !grouped.has(d)) };
    groups.push(group);
    seededUsers.push(user.name);
    try {
      writeGroups({ groups, seededUsers });
      if (!view) view = { defaultFilter: group.id, hidden: [] };
    } catch (e) { groups.pop(); }
  }

  view = cleanView(view, groups, domains);
  try { writeView(user, view); } catch (e) { /* read-only home: still show the list */ }
  return { user: user.name, canEditGroups: isRoot(), groups, ...view };
}

// Shared across all logins, so it lives under /var/lib and needs root.
async function saveGroups(groups) {
  const domains = (await apache.listVhosts()).map((v) => v.domain);
  const stored = readJson(GROUPS_FILE) || {};
  const clean = cleanGroups(groups, domains);
  try {
    writeGroups({ groups: clean, seededUsers: Array.isArray(stored.seededUsers) ? stored.seededUsers : [] });
  } catch (e) {
    return { ok: false, error: `Could not save groups: ${e.message}` };
  }
  return { ok: true, groups: clean };
}

// Per-login: default group and hidden sites.
async function saveView(view) {
  const user = getInvokingUser();
  const domains = (await apache.listVhosts()).map((v) => v.domain);
  const groups = cleanGroups((readJson(GROUPS_FILE) || {}).groups, domains);
  const clean = cleanView(view, groups, domains);
  try {
    writeView(user, clean);
  } catch (e) {
    return { ok: false, error: `Could not save view: ${e.message}` };
  }
  return { ok: true, ...clean };
}

module.exports = { get, saveGroups, saveView };
