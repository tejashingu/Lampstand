const fs = require('fs');
const { runCommand } = require('./exec');
const { isValidUsername, isValidGroup } = require('./validate');

const MIN_UID = 1000;
const MAX_UID = 60000;

function listSystemUsers() {
  const passwd = fs.readFileSync('/etc/passwd', 'utf8');
  return passwd
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [name, , uid, , , home, shell] = line.split(':');
      return { name, uid: parseInt(uid, 10), home, shell };
    })
    .filter((u) => u.uid >= MIN_UID && u.uid <= MAX_UID && !u.shell.endsWith('nologin') && !u.shell.endsWith('false'));
}

function listGroupMembers(group) {
  const groupFile = fs.readFileSync('/etc/group', 'utf8');
  const line = groupFile.split('\n').find((l) => l.startsWith(`${group}:`));
  if (!line) return [];
  const members = line.split(':')[3] || '';
  return members.split(',').filter(Boolean);
}

async function listUsersWithGroups(groups = ['www-data', 'nvm']) {
  const users = listSystemUsers();
  const memberships = {};
  groups.forEach((g) => (memberships[g] = new Set(listGroupMembers(g))));

  return users.map((u) => ({
    ...u,
    groups: groups.filter((g) => memberships[g].has(u.name)),
  }));
}

async function addUserToGroup(username, group) {
  if (!isValidUsername(username)) return { ok: false, error: 'Invalid username' };
  if (!isValidGroup(group)) return { ok: false, error: 'Invalid group name' };
  const res = await runCommand('usermod', ['-aG', group, username]);
  return { ok: res.ok, error: res.ok ? null : res.stderr };
}

async function removeUserFromGroup(username, group) {
  if (!isValidUsername(username)) return { ok: false, error: 'Invalid username' };
  if (!isValidGroup(group)) return { ok: false, error: 'Invalid group name' };
  const res = await runCommand('gpasswd', ['-d', username, group]);
  return { ok: res.ok, error: res.ok ? null : res.stderr };
}

async function createUser(username, password) {
  if (!isValidUsername(username)) return { ok: false, error: 'Invalid username' };
  const useradd = await runCommand('useradd', ['-m', '-s', '/bin/bash', username]);
  if (!useradd.ok) return { ok: false, error: useradd.stderr };
  if (password) {
    const chpasswd = await runCommand('chpasswd', [], { input: `${username}:${password}\n` });
    if (!chpasswd.ok) return { ok: false, error: chpasswd.stderr };
  }
  return { ok: true };
}

module.exports = { listUsersWithGroups, addUserToGroup, removeUserFromGroup, createUser };
