const fs = require('fs');
const { runCommand, runAptInstall } = require('./exec');

// Superset of PHP extensions required/recommended by WordPress, Drupal and Laravel.
// --ignore-missing is used on install since some of these are core-compiled in
// newer PHP versions and have no separate apt package (e.g. php-json on PHP 8+).
const PHP_PACKAGES = [
  'php',
  'libapache2-mod-php',
  'php-cli',
  'php-common',
  'php-mysql',
  'php-curl',
  'php-gd',
  'php-mbstring',
  'php-xml',
  'php-zip',
  'php-bcmath',
  'php-intl',
  'php-imagick',
  'php-opcache',
  'php-soap',
  'php-xmlrpc',
  'php-cgi',
  'php-readline',
  'php-sqlite3',
];

async function getOsInfo() {
  let osRelease = '';
  try {
    osRelease = fs.readFileSync('/etc/os-release', 'utf8');
  } catch (e) {
    /* ignore */
  }
  const get = (key) => {
    const m = osRelease.match(new RegExp(`^${key}="?([^"\n]*)"?$`, 'm'));
    return m ? m[1] : '';
  };
  return {
    name: get('NAME') || 'Unknown',
    version: get('VERSION') || '',
    id: get('ID') || '',
    prettyName: get('PRETTY_NAME') || 'Unknown Linux',
    // Official flavours (Kubuntu, Xubuntu, ...) report ID=ubuntu; derivatives built on the
    // Ubuntu archive (Linux Mint, Pop!_OS, Zorin, ...) list it in ID_LIKE.
    isUbuntu: get('ID') === 'ubuntu' || get('ID_LIKE').split(' ').includes('ubuntu'),
  };
}

async function isPackageInstalled(pkg) {
  const res = await runCommand('dpkg-query', ['-W', '-f=${Status}', pkg]);
  return res.ok && res.stdout.includes('install ok installed');
}

async function commandExists(cmd) {
  const res = await runCommand('bash', ['-lc', `command -v ${cmd}`]);
  return res.ok && res.stdout.trim().length > 0;
}

async function getVersion(cmd, args = ['--version']) {
  const res = await runCommand(cmd, args);
  if (!res.ok) return null;
  const m = (res.stdout || res.stderr).match(/\d+\.\d+(\.\d+)?/);
  return m ? m[0] : (res.stdout || '').split('\n')[0];
}

async function checkStack() {
  const [apache, php, mysql, phpmyadmin, node, nvm] = await Promise.all([
    isPackageInstalled('apache2'),
    isPackageInstalled('php'),
    isPackageInstalled('mysql-server'),
    isPackageInstalled('phpmyadmin'),
    commandExists('node'),
    fs.existsSync('/usr/local/nvm/nvm.sh'),
  ]);

  const [apacheV, phpV, mysqlV, nodeV] = await Promise.all([
    apache ? getVersion('apache2', ['-v']) : null,
    php ? getVersion('php', ['-v']) : null,
    mysql ? getVersion('mysql', ['--version']) : null,
    node ? getVersion('node') : null,
  ]);

  return {
    apache: { installed: apache, version: apacheV },
    php: { installed: php, version: phpV },
    mysql: { installed: mysql, version: mysqlV },
    phpmyadmin: { installed: phpmyadmin, version: null },
    node: { installed: node, version: nodeV },
    nvm: { installed: nvm, version: null },
  };
}

async function aptUpdate(onData) {
  return runCommand('apt-get', ['update'], { onData });
}

async function installApache(onProgress, onData) {
  return runAptInstall(['apache2'], { onProgress, onData });
}

async function installPhp(onProgress, onData) {
  return runAptInstall(PHP_PACKAGES, { onProgress, onData, ignoreMissing: true });
}

module.exports = {
  getOsInfo,
  isPackageInstalled,
  commandExists,
  checkStack,
  aptUpdate,
  installApache,
  installPhp,
  PHP_PACKAGES,
};
