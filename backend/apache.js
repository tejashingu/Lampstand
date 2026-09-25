const fs = require('fs');
const path = require('path');
const { runCommand } = require('./exec');
const { isValidDomain, isSafePath } = require('./validate');

const SITES_AVAILABLE = '/etc/apache2/sites-available';
const SITES_ENABLED = '/etc/apache2/sites-enabled';
const HOSTS_FILE = '/etc/hosts';
const HOSTS_MARKER = '# lampstand';

function confPath(domain) {
  return path.join(SITES_AVAILABLE, `${domain}.conf`);
}

function vhostTemplate(domain, docRoot) {
  return `# Managed by Lampstand
<VirtualHost *:80>
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
      return {
        file: f,
        domain: serverName,
        docRoot,
        enabled: enabled.includes(f),
        managed: content.includes('# Managed by Lampstand'),
      };
    });
}

async function createVhost(domain, docRoot) {
  if (!isValidDomain(domain)) return { ok: false, error: 'Invalid domain name' };
  if (!isSafePath(docRoot)) return { ok: false, error: 'Invalid folder path' };

  fs.mkdirSync(docRoot, { recursive: true });

  fs.writeFileSync(confPath(domain), vhostTemplate(domain, docRoot), { mode: 0o644 });

  const enable = await runCommand('a2ensite', [`${domain}.conf`]);
  if (!enable.ok) return { ok: false, error: enable.stderr || 'a2ensite failed' };

  await addHostsEntry(domain);

  const reload = await runCommand('systemctl', ['reload', 'apache2']);
  return { ok: reload.ok, error: reload.ok ? null : reload.stderr };
}

async function deleteVhost(domain) {
  if (!isValidDomain(domain)) return { ok: false, error: 'Invalid domain name' };

  await runCommand('a2dissite', [`${domain}.conf`]);
  const cp = confPath(domain);
  if (fs.existsSync(cp)) fs.unlinkSync(cp);

  await removeHostsEntry(domain);

  const reload = await runCommand('systemctl', ['reload', 'apache2']);
  return { ok: reload.ok, error: reload.ok ? null : reload.stderr };
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
    return !(line.includes(domain) && line.includes(HOSTS_MARKER));
  });
  fs.writeFileSync(HOSTS_FILE, lines.join('\n'));
}

module.exports = { listVhosts, createVhost, deleteVhost, setVhostEnabled };
