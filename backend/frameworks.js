const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { runCommand, runAptInstall } = require('./exec');
const { isSafePath, isValidDomain } = require('./validate');

const LARAVEL_WRITABLE = ['storage', 'bootstrap/cache', 'database'];

// Every framework Lampstand knows about. `docRoot` is relative to the project
// folder, `writable` lists paths Apache (www-data) needs to write to, and
// `composer` (or `installer`) marks it as installable into an empty folder.
const FRAMEWORKS = {
  wordpress: {
    label: 'WordPress',
    description: 'Latest release from wordpress.org, with a MySQL database and wp-config.php ready to go.',
    docRoot: '',
    writable: ['.'],
    installer: 'wordpress',
    needsMysql: true,
  },
  laravel: {
    label: 'Laravel',
    description: 'composer create-project laravel/laravel (SQLite by default).',
    docRoot: 'public',
    writable: LARAVEL_WRITABLE,
    composer: 'laravel/laravel',
    laravelEnv: true,
  },
  'laravel-react': {
    label: 'Laravel + Inertia (React)',
    description: 'Official Laravel React starter kit — Inertia, React, TypeScript, Tailwind, auth scaffolding.',
    docRoot: 'public',
    writable: LARAVEL_WRITABLE,
    composer: 'laravel/react-starter-kit',
    laravelEnv: true,
    npmBuild: true,
  },
  'laravel-vue': {
    label: 'Laravel + Inertia (Vue)',
    description: 'Official Laravel Vue starter kit — Inertia, Vue 3, TypeScript, Tailwind, auth scaffolding.',
    docRoot: 'public',
    writable: LARAVEL_WRITABLE,
    composer: 'laravel/vue-starter-kit',
    laravelEnv: true,
    npmBuild: true,
  },
  'laravel-livewire': {
    label: 'Laravel + Livewire',
    description: 'Official Laravel Livewire starter kit — Livewire, Flux UI, Tailwind, auth scaffolding.',
    docRoot: 'public',
    writable: LARAVEL_WRITABLE,
    composer: 'laravel/livewire-starter-kit',
    laravelEnv: true,
    npmBuild: true,
  },
  symfony: {
    label: 'Symfony',
    description: 'symfony/skeleton + the "webapp" pack (Twig, Doctrine, forms, security, ...).',
    docRoot: 'public',
    writable: ['var'],
    composer: 'symfony/skeleton',
    composerAfter: ['require', 'webapp'],
    frontController: true,
  },
  drupal: {
    label: 'Drupal',
    description: 'drupal/recommended-project — finish the install in the browser.',
    docRoot: 'web',
    writable: (docRoot) => [path.join(docRoot || '.', 'sites/default')],
    composer: 'drupal/recommended-project',
  },
  codeigniter: {
    label: 'CodeIgniter 4',
    description: 'codeigniter4/appstarter.',
    docRoot: 'public',
    writable: ['writable'],
    composer: 'codeigniter4/appstarter',
  },
  cakephp: {
    label: 'CakePHP',
    description: 'cakephp/app application skeleton.',
    docRoot: 'webroot',
    writable: ['tmp', 'logs'],
    composer: 'cakephp/app',
  },
  yii: {
    label: 'Yii 2',
    description: 'yiisoft/yii2-app-basic.',
    docRoot: 'web',
    writable: ['runtime', 'web/assets'],
    composer: 'yiisoft/yii2-app-basic',
  },
  slim: {
    label: 'Slim',
    description: 'slim/slim-skeleton.',
    docRoot: 'public',
    writable: ['logs', 'var'],
    composer: 'slim/slim-skeleton',
    frontController: true,
  },
  // Detect-only: recognised in existing folders, not offered for fresh installs.
  craft: { label: 'Craft CMS', docRoot: 'web', writable: ['storage', 'config', 'web/cpresources'] },
  joomla: { label: 'Joomla', docRoot: '', writable: ['.'] },
  php: { label: 'Plain PHP / static site', docRoot: '', writable: [] },
};

const NODE_FRAMEWORKS = {
  next: 'Next.js',
  nuxt: 'Nuxt',
  '@sveltejs/kit': 'SvelteKit',
  astro: 'Astro',
  '@remix-run/node': 'Remix',
  '@nestjs/core': 'NestJS',
  express: 'Express',
};

function listFrameworks() {
  return Object.entries(FRAMEWORKS).map(([key, f]) => ({
    key,
    label: f.label,
    description: f.description || '',
    docRoot: f.docRoot,
    installable: Boolean(f.composer || f.installer),
    needsMysql: Boolean(f.needsMysql),
  }));
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return null;
  }
}

/**
 * Inspect a folder and work out which framework (if any) lives in it, and
 * which subfolder Apache should serve.
 */
function detect(dir) {
  if (!isSafePath(dir)) return { ok: false, error: 'Invalid folder path' };
  if (!fs.existsSync(dir)) return { ok: true, exists: false, empty: true, framework: null };
  if (!fs.statSync(dir).isDirectory()) return { ok: false, error: 'Not a folder' };

  const entries = fs.readdirSync(dir);
  if (!entries.length) return { ok: true, exists: true, empty: true, framework: null };

  const has = (p) => fs.existsSync(path.join(dir, p));
  const composer = readJson(path.join(dir, 'composer.json'));
  const deps = composer ? { ...composer.require, ...composer['require-dev'] } : {};
  const pkg = readJson(path.join(dir, 'package.json'));
  const npmDeps = pkg ? { ...pkg.dependencies, ...pkg.devDependencies } : {};

  let framework = null;
  let docRoot = null;
  const warnings = [];

  if (deps['roots/wordpress']) {
    framework = 'wordpress'; // Bedrock
    docRoot = 'web';
  } else if (has('wp-includes') && (has('wp-config.php') || has('wp-config-sample.php') || has('wp-load.php'))) {
    framework = 'wordpress';
  } else if (deps['laravel/framework'] || (has('artisan') && has('bootstrap/app.php'))) {
    if (npmDeps['@inertiajs/react']) framework = 'laravel-react';
    else if (npmDeps['@inertiajs/vue3']) framework = 'laravel-vue';
    else if (deps['livewire/livewire'] || deps['livewire/flux']) framework = 'laravel-livewire';
    else framework = 'laravel';
    if (framework !== 'laravel' && !has('public/build')) {
      warnings.push('Frontend assets are not built yet — run "npm install && npm run build" (or "npm run dev") in the project.');
    }
  } else if (deps['drupal/core-recommended'] || deps['drupal/core'] || has('core/lib/Drupal.php')) {
    framework = 'drupal';
    docRoot = has('web/index.php') ? 'web' : has('docroot/index.php') ? 'docroot' : '';
  } else if (deps['symfony/framework-bundle']) {
    framework = 'symfony';
  } else if (deps['codeigniter4/framework'] || has('spark')) {
    framework = 'codeigniter';
  } else if (deps['cakephp/cakephp']) {
    framework = 'cakephp';
  } else if (deps['yiisoft/yii2']) {
    framework = 'yii';
  } else if (deps['craftcms/cms']) {
    framework = 'craft';
  } else if (deps['slim/slim']) {
    framework = 'slim';
  } else if (has('administrator') && (has('libraries/src') || has('libraries/joomla'))) {
    framework = 'joomla';
  } else {
    framework = 'php';
    if (has('public/index.php') || has('public/index.html')) docRoot = 'public';
    const nodeKey = Object.keys(NODE_FRAMEWORKS).find((k) => npmDeps[k]);
    if (nodeKey) {
      warnings.push(`This looks like a ${NODE_FRAMEWORKS[nodeKey]} app. Apache will only serve its static files — run the app's own dev server for full functionality.`);
    }
  }

  if (composer && !has('vendor')) {
    warnings.push('Composer dependencies are not installed — run "composer install" in the project.');
  }

  const docRootRel = docRoot !== null ? docRoot : FRAMEWORKS[framework].docRoot;
  return {
    ok: true,
    exists: true,
    empty: false,
    framework,
    label: FRAMEWORKS[framework].label,
    docRootRel,
    docRoot: docRootRel ? path.join(dir, docRootRel) : dir,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Running commands as the project's owner (composer/npm must not run as root,
// and the files should belong to the developer, not root).
// ---------------------------------------------------------------------------

function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

async function userFromUid(uid) {
  const res = await runCommand('getent', ['passwd', String(uid)]);
  if (!res.ok) return null;
  const [name, , , gid, , home] = res.stdout.trim().split(':');
  return name ? { name, uid, gid: parseInt(gid, 10), home } : null;
}

/**
 * The owner is whoever owns the nearest existing parent folder, falling back
 * to the user who launched Lampstand through pkexec/sudo, then root.
 */
async function resolveOwner(dir) {
  let probe = dir;
  while (!fs.existsSync(probe) && probe !== path.dirname(probe)) probe = path.dirname(probe);
  // A folder the file dialog just created (as root) doesn't say who it's for.
  if (probe === dir && fs.statSync(probe).uid === 0) probe = path.dirname(probe);
  const parentUid = fs.statSync(probe).uid;
  if (parentUid >= 1000) {
    const u = await userFromUid(parentUid);
    if (u) return u;
  }
  const invoker = parseInt(process.env.PKEXEC_UID || process.env.SUDO_UID || '', 10);
  if (!isNaN(invoker) && invoker > 0) {
    const u = await userFromUid(invoker);
    if (u) return u;
  }
  return { name: 'root', uid: 0, gid: 0, home: '/root' };
}

function runAs(owner, script, onData) {
  const full = `export COMPOSER_NO_INTERACTION=1; ${script}`;
  if (owner.uid === 0) {
    return runCommand('bash', ['-lc', full], { onData, env: { COMPOSER_ALLOW_SUPERUSER: '1' } });
  }
  // Login shell so /etc/profile.d/nvm.sh (shared NVM) is loaded.
  return runCommand('runuser', ['-l', owner.name, '-c', full], { onData });
}

async function ensureComposer(log, onData) {
  const res = await runCommand('bash', ['-lc', 'command -v composer']);
  if (res.ok && res.stdout.trim()) return true;
  log('Composer not found — installing it from the Ubuntu repositories...');
  const install = await runAptInstall(['composer', 'unzip'], { onData, ignoreMissing: true });
  return install.ok;
}

// ---------------------------------------------------------------------------
// Installers
// ---------------------------------------------------------------------------

function randomString(len) {
  return crypto.randomBytes(len).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, len);
}

async function createMysqlDatabase(domain, rootPassword, log) {
  const ident = domain.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'site';
  const dbPassword = randomString(24);
  const sql = `
    CREATE DATABASE IF NOT EXISTS \`${ident}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    CREATE USER IF NOT EXISTS '${ident}'@'localhost' IDENTIFIED BY '${dbPassword}';
    ALTER USER '${ident}'@'localhost' IDENTIFIED BY '${dbPassword}';
    GRANT ALL PRIVILEGES ON \`${ident}\`.* TO '${ident}'@'localhost';
    FLUSH PRIVILEGES;
  `;
  log(`Creating MySQL database and user "${ident}"...`);
  const env = rootPassword ? { MYSQL_PWD: rootPassword } : {};
  const res = await runCommand('mysql', ['-u', 'root'], { input: sql, env });
  if (!res.ok) {
    return { ok: false, error: `MySQL: ${res.stderr.trim() || 'could not create database'} (check the MySQL root password)` };
  }
  return { ok: true, name: ident, user: ident, password: dbPassword };
}

async function installWordpress(dir, owner, { domain, mysqlRootPassword }, log, onData) {
  const db = await createMysqlDatabase(domain, mysqlRootPassword, log);
  if (!db.ok) return db;

  log('Downloading the latest WordPress from wordpress.org...');
  let buf;
  try {
    const res = await fetch('https://wordpress.org/latest.tar.gz');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    const cause = e.cause?.code || e.cause?.message;
    return { ok: false, error: `Download failed: ${e.message}${cause ? ` (${cause})` : ''}` };
  }
  const tarball = path.join(os.tmpdir(), `lampstand-wordpress-${Date.now()}.tar.gz`);
  fs.writeFileSync(tarball, buf, { mode: 0o644 });

  log('Extracting...');
  const extract = await runAs(owner, `tar -xzf ${shq(tarball)} -C ${shq(dir)} --strip-components=1`, onData);
  fs.unlinkSync(tarball);
  if (!extract.ok) return { ok: false, error: extract.stderr || 'Extracting WordPress failed' };

  log('Writing wp-config.php...');
  const sample = fs.readFileSync(path.join(dir, 'wp-config-sample.php'), 'utf8');
  const config = sample
    .replace('database_name_here', db.name)
    .replace('username_here', db.user)
    .replace('password_here', db.password)
    .replace(/put your unique phrase here/g, () => randomString(64))
    .replace("/* That's all, stop editing!", "define( 'FS_METHOD', 'direct' );\n\n/* That's all, stop editing!");
  const configPath = path.join(dir, 'wp-config.php');
  fs.writeFileSync(configPath, config, { mode: 0o640 });
  fs.chownSync(configPath, owner.uid, owner.gid);

  return { ok: true, notes: [`MySQL database "${db.name}" (user "${db.user}") created — credentials are in wp-config.php. Open the site to finish the WordPress install.`] };
}

async function installComposerProject(fw, dir, owner, { domain }, log, onData) {
  if (!(await ensureComposer(log, onData))) return { ok: false, error: 'Could not install Composer' };

  log(`Running composer create-project ${fw.composer} (this can take a few minutes)...`);
  const create = await runAs(owner, `composer create-project --prefer-dist ${fw.composer} ${shq(dir)}`, onData);
  if (!create.ok) return { ok: false, error: `composer create-project failed — see the log for details` };

  if (fw.composerAfter) {
    log(`Running composer ${fw.composerAfter.join(' ')}...`);
    const after = await runAs(owner, `cd ${shq(dir)} && composer ${fw.composerAfter.map(shq).join(' ')}`, onData);
    if (!after.ok) return { ok: false, error: `composer ${fw.composerAfter.join(' ')} failed — see the log for details` };
  }

  const notes = [];

  if (fw.laravelEnv) {
    const envPath = path.join(dir, '.env');
    if (fs.existsSync(envPath)) {
      log('Setting APP_URL in .env...');
      const env = fs.readFileSync(envPath, 'utf8').replace(/^APP_URL=.*$/m, `APP_URL=http://${domain}`);
      fs.writeFileSync(envPath, env);
    }
  }

  if (fw.npmBuild) {
    const npmCheck = await runAs(owner, 'command -v npm', null);
    if (npmCheck.ok && npmCheck.stdout.trim()) {
      log('Installing frontend dependencies and building assets (npm install && npm run build)...');
      const build = await runAs(owner, `cd ${shq(dir)} && npm install && npm run build`, onData);
      if (!build.ok) notes.push('npm build failed — run "npm install && npm run build" in the project to fix the frontend.');
    } else {
      notes.push('Node.js/npm not found, so frontend assets were not built. Install Node (Setup Wizard) and run "npm install && npm run build".');
    }
  }

  return { ok: true, notes };
}

// ---------------------------------------------------------------------------
// Post-setup touches shared by fresh installs and existing projects
// ---------------------------------------------------------------------------

const FRONT_CONTROLLER_HTACCESS = `<IfModule mod_rewrite.c>
    RewriteEngine On
    RewriteCond %{REQUEST_FILENAME} !-f
    RewriteCond %{REQUEST_FILENAME} !-d
    RewriteRule ^ index.php [QSA,L]
</IfModule>
`;

function prepareDrupal(docRoot, owner, log) {
  const sitesDefault = path.join(docRoot, 'sites', 'default');
  if (!fs.existsSync(sitesDefault)) return;
  const settings = path.join(sitesDefault, 'settings.php');
  const defaults = path.join(sitesDefault, 'default.settings.php');
  if (!fs.existsSync(settings) && fs.existsSync(defaults)) {
    log('Creating sites/default/settings.php...');
    fs.copyFileSync(defaults, settings);
    fs.chownSync(settings, owner.uid, owner.gid);
  }
  const files = path.join(sitesDefault, 'files');
  if (!fs.existsSync(files)) {
    fs.mkdirSync(files);
    fs.chownSync(files, owner.uid, owner.gid);
  }
}

async function makeWritable(dir, rels, log) {
  for (const rel of rels) {
    const target = path.join(dir, rel);
    if (!fs.existsSync(target)) continue;
    log(`Giving Apache write access to ${rel === '.' ? 'the project folder' : rel}...`);
    await runCommand('chgrp', ['-R', 'www-data', target]);
    await runCommand('chmod', ['-R', 'g+rwX', target]);
    if (fs.statSync(target).isDirectory()) {
      // setgid so files created later (by the developer or Apache) keep the www-data group
      await runCommand('find', [target, '-type', 'd', '-exec', 'chmod', 'g+s', '{}', '+']);
    }
  }
}

/**
 * Prepare a project folder for a new vhost: either install a fresh framework
 * into it, or use what's already there. Returns the DocumentRoot to use.
 *
 * opts: { domain, projectDir, mode: 'existing'|'install', framework, mysqlRootPassword, fixPermissions }
 */
async function prepareSite(opts, onData) {
  const { domain, projectDir, mode, mysqlRootPassword, fixPermissions = true } = opts;
  const log = (line) => onData && onData({ stream: 'stdout', line, kind: 'stage' });

  if (!isValidDomain(domain)) return { ok: false, error: 'Invalid domain name' };
  if (!isSafePath(projectDir)) return { ok: false, error: 'Invalid folder path' };

  const scan = detect(projectDir);
  if (!scan.ok) return scan;

  let key = opts.framework || null;
  let docRootRel;
  let notes = [];

  if (mode === 'install' && key && key !== 'none') {
    const fw = FRAMEWORKS[key];
    if (!fw || !(fw.composer || fw.installer)) return { ok: false, error: 'Unknown framework' };
    if (!scan.empty) return { ok: false, error: 'The project folder must be empty to install a new framework into it' };

    const owner = await resolveOwner(projectDir);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.chownSync(projectDir, owner.uid, owner.gid);
    log(`Installing ${fw.label} as user "${owner.name}"...`);

    const res = fw.installer === 'wordpress'
      ? await installWordpress(projectDir, owner, { domain, mysqlRootPassword }, log, onData)
      : await installComposerProject(fw, projectDir, owner, { domain }, log, onData);
    if (!res.ok) return res;
    notes = notes.concat(res.notes || []);
    docRootRel = fw.docRoot;
  } else if (mode === 'install' || scan.empty) {
    key = null;
    docRootRel = '';
  } else {
    // Existing project: trust the scan unless the user overrode the framework.
    if (!key || key === 'auto') key = scan.framework;
    if (!FRAMEWORKS[key]) return { ok: false, error: 'Unknown framework' };
    docRootRel = key === scan.framework ? scan.docRootRel : FRAMEWORKS[key].docRoot;
    notes = notes.concat(scan.warnings || []);
  }

  const docRoot = docRootRel ? path.join(projectDir, docRootRel) : projectDir;
  const fw = key ? FRAMEWORKS[key] : null;

  if (fw && fw !== FRAMEWORKS.php) {
    const owner = await resolveOwner(projectDir);
    if (key === 'drupal') prepareDrupal(docRoot, owner, log);
    if (fw.frontController && fs.existsSync(path.join(docRoot, 'index.php')) && !fs.existsSync(path.join(docRoot, '.htaccess'))) {
      log('Adding a front-controller .htaccess...');
      const ht = path.join(docRoot, '.htaccess');
      fs.writeFileSync(ht, FRONT_CONTROLLER_HTACCESS, { mode: 0o644 });
      fs.chownSync(ht, owner.uid, owner.gid);
    }
    if (mode === 'install' || fixPermissions) {
      const writable = typeof fw.writable === 'function' ? fw.writable(docRootRel) : fw.writable;
      await makeWritable(projectDir, writable, log);
    }
  }

  return { ok: true, docRoot, framework: key, label: fw ? fw.label : null, notes };
}

// ---------------------------------------------------------------------------
// Finding (and removing) a site's database
// ---------------------------------------------------------------------------

const DB_NAME_RE = /^[A-Za-z0-9_$-]{1,64}$/;
const DB_USER_RE = /^[A-Za-z0-9_.-]{1,32}$/;
const LOCAL_HOSTS = ['', 'localhost', '127.0.0.1', '::1'];

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (e) {
    return null;
  }
}

/** Parse a dotenv file (later files override earlier ones). */
function readEnv(...files) {
  const env = {};
  files.forEach((file) => {
    const text = readText(file);
    if (!text) return;
    text.split('\n').forEach((line) => {
      const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_.]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    });
  });
  return env;
}

function hostOnly(host) {
  return String(host || '').replace(/:\d+$/, '').trim();
}

/**
 * Work out which database a project uses by reading its config files.
 * Returns { engine: 'mysql', name, user, host } | { engine: 'sqlite', path } | null.
 */
function findDatabase(projectDir, framework) {
  const p = (...parts) => path.join(projectDir, ...parts);

  if (framework === 'wordpress') {
    const cfg = readText(p('wp-config.php')) || readText(path.join(path.dirname(projectDir), 'wp-config.php'));
    if (cfg) {
      const def = (k) => (cfg.match(new RegExp(`define\\(\\s*['"]${k}['"]\\s*,\\s*['"]([^'"]*)['"]`)) || [])[1];
      if (def('DB_NAME')) return { engine: 'mysql', name: def('DB_NAME'), user: def('DB_USER'), host: def('DB_HOST') };
    }
    const env = readEnv(p('.env')); // Bedrock
    if (env.DB_NAME) return { engine: 'mysql', name: env.DB_NAME, user: env.DB_USER, host: env.DB_HOST };
    return null;
  }

  if (framework && framework.startsWith('laravel')) {
    const env = readEnv(p('.env'));
    const conn = env.DB_CONNECTION || 'sqlite';
    if (conn === 'sqlite') {
      const file = env.DB_DATABASE && path.isAbsolute(env.DB_DATABASE) ? env.DB_DATABASE : p('database', 'database.sqlite');
      return fs.existsSync(file) ? { engine: 'sqlite', path: file } : null;
    }
    if (conn === 'mysql' || conn === 'mariadb') {
      return { engine: 'mysql', name: env.DB_DATABASE, user: env.DB_USERNAME, host: env.DB_HOST };
    }
    return null;
  }

  if (framework === 'symfony') {
    const env = readEnv(p('.env'), p('.env.local'));
    if (!env.DATABASE_URL) return null;
    try {
      const url = new URL(env.DATABASE_URL);
      if (url.protocol.startsWith('mysql') || url.protocol.startsWith('mariadb')) {
        return { engine: 'mysql', name: url.pathname.replace(/^\//, ''), user: decodeURIComponent(url.username), host: url.hostname };
      }
      if (url.protocol.startsWith('sqlite')) return null; // lives in var/, removed with the folder
    } catch (e) { /* unparseable URL */ }
    return null;
  }

  if (framework === 'craft') {
    const env = readEnv(p('.env'));
    const name = env.CRAFT_DB_DATABASE || env.DB_DATABASE;
    const driver = env.CRAFT_DB_DRIVER || env.DB_DRIVER || 'mysql';
    if (name && driver === 'mysql') return { engine: 'mysql', name, user: env.CRAFT_DB_USER || env.DB_USER, host: env.CRAFT_DB_SERVER || env.DB_SERVER };
    return null;
  }

  if (framework === 'codeigniter') {
    const env = readEnv(p('.env'));
    const name = env['database.default.database'];
    const driver = env['database.default.DBDriver'] || 'MySQLi';
    if (name && /mysql/i.test(driver)) return { engine: 'mysql', name, user: env['database.default.username'], host: env['database.default.hostname'] };
    return null;
  }

  if (framework === 'drupal') {
    for (const rel of ['web', 'docroot', '.']) {
      const cfg = readText(p(rel, 'sites', 'default', 'settings.php'));
      if (!cfg) continue;
      const block = (cfg.match(/^\s*\$databases\['default'\]\['default'\]\s*=\s*(?:array\s*\(|\[)[\s\S]*?(?:\);|\];)/m) || [])[0];
      if (!block) continue;
      const get = (k) => (block.match(new RegExp(`'${k}'\\s*=>\\s*'([^']*)'`)) || [])[1];
      if (get('driver') === 'mysql' && get('database')) return { engine: 'mysql', name: get('database'), user: get('username'), host: get('host') };
      if (get('driver') === 'sqlite' && get('database')) {
        const file = path.isAbsolute(get('database')) ? get('database') : p(rel, get('database'));
        return { engine: 'sqlite', path: file };
      }
    }
    return null;
  }

  if (framework === 'yii') {
    const cfg = readText(p('config', 'db.php'));
    const dsn = cfg && (cfg.match(/'dsn'\s*=>\s*'mysql:([^']*)'/) || [])[1];
    if (!dsn) return null;
    const parts = Object.fromEntries(dsn.split(';').map((kv) => kv.split('=')));
    return { engine: 'mysql', name: parts.dbname, user: (cfg.match(/'username'\s*=>\s*'([^']*)'/) || [])[1], host: parts.host };
  }

  if (framework === 'cakephp') {
    const cfg = readText(p('config', 'app_local.php'));
    const block = cfg && (cfg.match(/'Datasources'\s*=>\s*\[\s*'default'\s*=>\s*\[([\s\S]*?)\]/) || [])[1];
    const get = (k) => block && (block.match(new RegExp(`'${k}'\\s*=>\\s*'([^']*)'`)) || [])[1];
    if (get('database')) return { engine: 'mysql', name: get('database'), user: get('username'), host: get('host') };
    return null;
  }

  if (framework === 'joomla') {
    const cfg = readText(p('configuration.php'));
    const get = (k) => cfg && (cfg.match(new RegExp(`public \\$${k}\\s*=\\s*'([^']*)'`)) || [])[1];
    if (get('db')) return { engine: 'mysql', name: get('db'), user: get('user'), host: get('host') };
    return null;
  }

  return null;
}

/** Describe the database as something Lampstand can (or can't) safely drop. */
function describeDatabase(db) {
  if (!db) return null;
  if (db.engine === 'sqlite') return { ...db, droppable: false, reason: 'SQLite file — removed together with the project folder' };
  const local = LOCAL_HOSTS.includes(hostOnly(db.host).toLowerCase());
  if (!db.name || !DB_NAME_RE.test(db.name)) return { ...db, droppable: false, reason: 'Database name could not be read safely' };
  if (!local) return { ...db, droppable: false, reason: `Database is on another server (${db.host})` };
  if (['mysql', 'sys', 'information_schema', 'performance_schema', 'phpmyadmin'].includes(db.name.toLowerCase())) {
    return { ...db, droppable: false, reason: 'System database — never dropped' };
  }
  return { ...db, droppable: true };
}

/**
 * DROP DATABASE, and drop its user too — but only when that user isn't root,
 * has no server-wide privileges and isn't granted access to any other database.
 */
async function dropMysqlDatabase(db, rootPassword, log) {
  const env = rootPassword ? { MYSQL_PWD: rootPassword } : {};
  const mysql = (sql, args = []) => runCommand('mysql', ['-u', 'root', ...args], { input: sql, env });

  const ping = await mysql('SELECT 1;');
  if (!ping.ok) return { ok: false, error: `MySQL: ${ping.stderr.trim() || 'login failed'} (check the MySQL root password)` };

  log(`Dropping database "${db.name}"...`);
  const drop = await mysql(`DROP DATABASE IF EXISTS \`${db.name.replace(/`/g, '``')}\`;`);
  if (!drop.ok) return { ok: false, error: `MySQL: ${drop.stderr.trim()}` };

  const notes = [`Database "${db.name}" dropped.`];
  const user = db.user;
  if (!user || !DB_USER_RE.test(user) || user === 'root' || user === 'phpmyadmin' || user === 'debian-sys-maint') {
    if (user) notes.push(`MySQL user "${user}" kept (shared/system account).`);
    return { ok: true, notes };
  }

  const other = await mysql(
    `SELECT
       (SELECT COUNT(*) FROM mysql.db WHERE User='${user}' AND REPLACE(Db,'\\\\_','_') <> '${db.name}') +
       (SELECT COUNT(*) FROM mysql.user WHERE User='${user}' AND (Select_priv='Y' OR Create_priv='Y' OR Super_priv='Y'));`,
    ['-N', '-B']
  );
  if (!other.ok || parseInt(other.stdout.trim(), 10) > 0) {
    notes.push(`MySQL user "${user}" kept — it has access to other databases.`);
    return { ok: true, notes };
  }

  log(`Dropping MySQL user "${user}"...`);
  const dropUser = await mysql(`DROP USER IF EXISTS '${user}'@'localhost', '${user}'@'127.0.0.1'; FLUSH PRIVILEGES;`);
  notes.push(dropUser.ok ? `MySQL user "${user}" dropped.` : `Could not drop MySQL user "${user}": ${dropUser.stderr.trim()}`);
  return { ok: true, notes };
}

/**
 * Given a vhost's DocumentRoot, find the project folder it belongs to
 * (Laravel's /public, Drupal's /web, ... live one level below the project).
 */
function inferProjectDir(docRoot) {
  const base = path.basename(docRoot);
  if (['public', 'web', 'webroot', 'docroot'].includes(base)) {
    const parent = path.dirname(docRoot);
    const scan = detect(parent);
    if (scan.ok && !scan.empty && scan.framework !== 'php' && scan.docRoot === docRoot) return parent;
    if (fs.existsSync(path.join(parent, 'composer.json'))) return parent;
  }
  return docRoot;
}

module.exports = {
  FRAMEWORKS,
  listFrameworks,
  detect,
  prepareSite,
  findDatabase,
  describeDatabase,
  dropMysqlDatabase,
  inferProjectDir,
};
