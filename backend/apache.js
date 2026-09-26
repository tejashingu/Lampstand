const fs = require('fs');
const path = require('path');
const { runCommand } = require('./exec');
const { isValidDomain, isSafePath } = require('./validate');
const frameworks = require('./frameworks');

const SITES_AVAILABLE = '/etc/apache2/sites-available';
const SITES_ENABLED = '/etc/apache2/sites-enabled';
const HOSTS_FILE = '/etc/hosts';
const HOSTS_MARKER = '# lampstand';

function confPath(domain) {
  return path.join(SITES_AVAILABLE, `${domain}.conf`);
}

function vhostTemplate(domain, docRoot, { frameworkLabel, frameworkKey, projectDir } = {}) {
  const meta = [
    frameworkLabel ? `# Framework: ${frameworkLabel}` : null,
    frameworkKey ? `# FrameworkKey: ${frameworkKey}` : null,
    projectDir ? `# Project: ${projectDir}` : null,
  ].filter(Boolean).map((l) => `${l}\n`).join('');
  return `# Managed by Lampstand
${meta}<VirtualHost *:80>
    ServerName ${domain}
    DocumentRoot ${docRoot}

    <Directory ${docRoot}>
        Options Indexes FollowSymLinks
        AllowOverride All
        Require all granted
    </Directory>

    ErrorLog \${APACHE_LOG_DIR}/${domain}-error.log
    CustomLog \${APACHE_LOG_DIR}/${domain}-access.log combined
</VirtualHost>
`;
}

async function listVhosts() {
  if (!fs.existsSync(SITES_AVAILABLE)) return [];
  const files = fs.readdirSync(SITES_AVAILABLE).filter((f) => f.endsWith('.conf'));
  const enabled = fs.existsSync(SITES_ENABLED) ? fs.readdirSync(SITES_ENABLED) : [];

  return files
    .filter((f) => f !== '000-default.conf' && f !== 'default-ssl.conf')
    .map((f) => {
      const content = fs.readFileSync(path.join(SITES_AVAILABLE, f), 'utf8');
      const serverName = (content.match(/ServerName\s+(\S+)/) || [])[1] || f.replace('.conf', '');
      const docRoot = (content.match(/DocumentRoot\s+(\S+)/) || [])[1] || '';
      const framework = (content.match(/^# Framework: (.+)$/m) || [])[1] || null;
      const frameworkKey = (content.match(/^# FrameworkKey: (\S+)$/m) || [])[1] || null;
      const projectDir = (content.match(/^# Project: (.+)$/m) || [])[1] || null;
      return {
        file: f,
        domain: serverName,
        docRoot,
        framework,
        frameworkKey,
        projectDir,
        enabled: enabled.includes(f),
        managed: content.includes('# Managed by Lampstand'),
      };
    });
}

async function createVhost(domain, docRoot, { frameworkLabel, frameworkKey, projectDir } = {}) {
  if (!isValidDomain(domain)) return { ok: false, error: 'Invalid domain name' };
  if (!isSafePath(docRoot)) return { ok: false, error: 'Invalid folder path' };

  fs.mkdirSync(docRoot, { recursive: true });

  fs.writeFileSync(confPath(domain), vhostTemplate(domain, docRoot, { frameworkLabel, frameworkKey, projectDir }), { mode: 0o644 });

  // Laravel, WordPress permalinks, Drupal, ... all rely on .htaccess rewrites.
  await runCommand('a2enmod', ['-q', 'rewrite']);

  const enable = await runCommand('a2ensite', [`${domain}.conf`]);
  if (!enable.ok) return { ok: false, error: enable.stderr || 'a2ensite failed' };

  await addHostsEntry(domain);

  // restart rather than reload in case a2enmod just enabled a module
  const restart = await runCommand('systemctl', ['restart', 'apache2']);
  if (!restart.ok) return { ok: false, error: restart.stderr };

  const warnings = [];
  const reachable = await runCommand('runuser', ['-u', 'www-data', '--', 'test', '-x', docRoot]);
  if (!reachable.ok) {
    warnings.push(`Apache (www-data) can't open ${docRoot}. A parent folder is probably private — e.g. run "chmod o+x" on your home folder, or keep projects under /var/www.`);
  }
  return { ok: true, error: null, warnings };
}

// Folders that must never be removed wholesale, even if a vhost points at them.
const PROTECTED_DIRS = ['/', '/home', '/root', '/var', '/var/www', '/var/www/html', '/srv', '/opt', '/tmp', '/usr', '/usr/local', '/mnt', '/media'];
const SYSTEM_TOP_DIRS = ['bin', 'boot', 'dev', 'etc', 'lib', 'lib32', 'lib64', 'proc', 'run', 'sbin', 'snap', 'sys', 'usr'];

function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function homeDirs() {
  try {
    return fs.readFileSync('/etc/passwd', 'utf8').split('\n').map((l) => l.split(':')[5]).filter(Boolean);
  } catch (e) {
    return [];
  }
}

/** Returns a reason string if the folder must not be deleted, otherwise null. */
function fileDeletionBlocker(projectDir, domain, allVhosts) {
  if (!isSafePath(projectDir)) return 'Folder path looks unsafe';
  if (!fs.existsSync(projectDir)) return 'Folder no longer exists';
  let real;
  try { real = fs.realpathSync(projectDir); } catch (e) { return 'Folder cannot be read'; }
  if (PROTECTED_DIRS.includes(real) || homeDirs().includes(real)) return `${real} is a system or home folder`;
  const top = real.split('/')[1];
  if (SYSTEM_TOP_DIRS.includes(top) || (top === 'var' && !isInside(real, '/var/www'))) return `${real} is inside a system folder`;
  if (real.split('/').filter(Boolean).length < 2) return `${real} is too close to the filesystem root`;
  const clash = allVhosts.find((v) => v.domain !== domain && v.docRoot && (isInside(v.docRoot, real) || isInside(real, v.docRoot)));
  if (clash) return `Another site (${clash.domain}) uses files in this folder`;
  return null;
}

/**
 * Everything the delete dialog needs to show: where the project lives, what
 * framework it is, which database it uses, and what can safely be removed.
 */
async function inspectVhost(domain) {
  if (!isValidDomain(domain)) return { ok: false, error: 'Invalid domain name' };
  const all = await listVhosts();
  const v = all.find((x) => x.domain === domain);
  if (!v) return { ok: false, error: 'Virtual host not found' };

  const projectDir = v.projectDir || (v.docRoot ? frameworks.inferProjectDir(v.docRoot) : null);
  let frameworkKey = v.frameworkKey;
  if (!frameworkKey && projectDir) {
    const scan = frameworks.detect(projectDir);
    if (scan.ok && !scan.empty) frameworkKey = scan.framework;
  }
  const fw = frameworkKey && frameworks.FRAMEWORKS[frameworkKey];
  const database = projectDir ? frameworks.describeDatabase(frameworks.findDatabase(projectDir, frameworkKey)) : null;

  return {
    ok: true,
    domain,
    docRoot: v.docRoot,
    projectDir,
    framework: v.framework || (fw ? fw.label : null),
    database,
    filesBlocked: projectDir ? fileDeletionBlocker(projectDir, domain, all) : 'No project folder recorded',
  };
}

/**
 * opts: { deleteFiles, dropDatabase, mysqlRootPassword }
 * Order matters: the database goes first (it's the step most likely to fail,
 * e.g. wrong password), so a failure leaves the site fully intact.
 */
async function deleteVhost(domain, opts = {}, onData) {
  if (!isValidDomain(domain)) return { ok: false, error: 'Invalid domain name' };
  const log = (line) => onData && onData({ stream: 'stdout', line, kind: 'stage' });
  const info = await inspectVhost(domain);
  if (!info.ok) return info;
  const notes = [];

  if (opts.dropDatabase) {
    if (!info.database || !info.database.droppable) {
      return { ok: false, error: info.database ? info.database.reason : 'No database found for this site' };
    }
    const res = await frameworks.dropMysqlDatabase(info.database, opts.mysqlRootPassword, log);
    if (!res.ok) return res;
    notes.push(...res.notes);
  }

  if (opts.deleteFiles && info.filesBlocked) {
    return { ok: false, error: `Project files not deleted: ${info.filesBlocked}`, notes };
  }

  log('Removing Apache config and /etc/hosts entry...');
  await runCommand('a2dissite', [`${domain}.conf`]);
  const cp = confPath(domain);
  if (fs.existsSync(cp)) fs.unlinkSync(cp);
  await removeHostsEntry(domain);
  const reload = await runCommand('systemctl', ['reload', 'apache2']);
  if (!reload.ok) notes.push(`Apache reload failed: ${reload.stderr.trim()}`);

  if (opts.deleteFiles) {
    log(`Deleting ${info.projectDir}...`);
    try {
      fs.rmSync(info.projectDir, { recursive: true, force: true });
      notes.push(`Deleted ${info.projectDir}.`);
    } catch (e) {
      return { ok: false, error: `Virtual host removed, but deleting files failed: ${e.message}`, notes };
    }
  }

  return { ok: true, notes };
}

async function setVhostEnabled(domain, enabled) {
  if (!isValidDomain(domain)) return { ok: false, error: 'Invalid domain name' };
  const res = await runCommand(enabled ? 'a2ensite' : 'a2dissite', [`${domain}.conf`]);
  if (!res.ok) return { ok: false, error: res.stderr };
  const reload = await runCommand('systemctl', ['reload', 'apache2']);
  return { ok: reload.ok, error: reload.ok ? null : reload.stderr };
}

async function addHostsEntry(domain) {
  const hosts = fs.readFileSync(HOSTS_FILE, 'utf8');
  const alreadyPresent = hosts.split('\n').some((line) => {
    const withoutComment = line.split('#')[0].trim();
    if (!withoutComment) return false;
    const tokens = withoutComment.split(/\s+/);
    return tokens.slice(1).includes(domain);
  });
  if (alreadyPresent) return;
  fs.appendFileSync(HOSTS_FILE, `127.0.0.1\t${domain}\t${HOSTS_MARKER}\n`);
}

async function removeHostsEntry(domain) {
  const hosts = fs.readFileSync(HOSTS_FILE, 'utf8');
  const lines = hosts.split('\n').filter((line) => {
    if (!line.includes(HOSTS_MARKER)) return true;
    const tokens = line.split('#')[0].trim().split(/\s+/);
    return !tokens.slice(1).includes(domain);
  });
  fs.writeFileSync(HOSTS_FILE, lines.join('\n'));
}

module.exports = { listVhosts, createVhost, inspectVhost, deleteVhost, setVhostEnabled };
