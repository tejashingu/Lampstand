const fs = require('fs');
const os = require('os');
const path = require('path');
const { runCommand } = require('./exec');

const DESKTOP_FILE_NAME = 'lampstand.desktop';

function lookupPasswdByName(name) {
  const passwd = fs.readFileSync('/etc/passwd', 'utf8');
  const line = passwd.split('\n').find((l) => l.startsWith(`${name}:`));
  if (!line) return null;
  const [n, , uid, gid, , home] = line.split(':');
  return { uid: parseInt(uid, 10), gid: parseInt(gid, 10), name: n, home };
}

function lookupPasswdByUid(uid) {
  const passwd = fs.readFileSync('/etc/passwd', 'utf8');
  const line = passwd.split('\n').find((l) => l.split(':')[2] === String(uid));
  if (!line) return null;
  const [n, , u, gid, , home] = line.split(':');
  return { uid: parseInt(u, 10), gid: parseInt(gid, 10), name: n, home };
}

/**
 * The whole app usually runs as root (via sudo/pkexec), but an autostart
 * entry has to live in the *real* user's session config, not root's. sudo
 * sets SUDO_USER and pkexec sets PKEXEC_UID for the invoking user — prefer
 * those, and fall back to whoever this process actually runs as (e.g. an
 * unprivileged, already-autostarted instance toggling itself off).
 */
function getInvokingUser() {
  if (process.env.SUDO_USER) {
    const info = lookupPasswdByName(process.env.SUDO_USER);
    if (info) return info;
  }
  if (process.env.PKEXEC_UID) {
    const info = lookupPasswdByUid(parseInt(process.env.PKEXEC_UID, 10));
    if (info) return info;
  }
  return {
    uid: typeof process.getuid === 'function' ? process.getuid() : 0,
    gid: typeof process.getgid === 'function' ? process.getgid() : 0,
    name: os.userInfo().username,
    home: os.homedir(),
  };
}

function autostartDir(user) {
  return path.join(user.home, '.config', 'autostart');
}
function autostartFile(user) {
  return path.join(autostartDir(user), DESKTOP_FILE_NAME);
}

async function isEnabled() {
  const user = getInvokingUser();
  return fs.existsSync(autostartFile(user));
}

async function setEnabled(enabled, execLine, iconPath) {
  const user = getInvokingUser();
  const dir = autostartDir(user);
  const file = autostartFile(user);

  if (!enabled) {
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return { ok: true };
  }

  fs.mkdirSync(dir, { recursive: true });
  const content = `[Desktop Entry]
Type=Application
Name=Lampstand
Comment=Local LAMP stack installer and virtual host manager
Exec=${execLine}
Icon=${iconPath}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
  fs.writeFileSync(file, content, { mode: 0o644 });

  // We're usually running as root here — hand the file back to the real user.
  await runCommand('chown', ['-R', `${user.uid}:${user.gid}`, dir]);

  return { ok: true };
}

module.exports = { isEnabled, setEnabled, getInvokingUser };
