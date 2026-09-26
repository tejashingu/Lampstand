// Stand-in for preload.js used only by scripts/screenshots: exposes the same
// window.api surface, backed by made-up sample data instead of the real system.
const { contextBridge, ipcRenderer } = require('electron');

// Skip the first-launch terms dialog and pin the light theme.
localStorage.setItem('vhm_tos_accepted', 'true');
localStorage.setItem('vhm_theme', 'light');

const ok = async () => ({ ok: true });

const stack = {
  apache: { installed: true, version: '2.4.58' },
  php: { installed: true, version: '8.3.6' },
  mysql: { installed: true, version: '8.0.39' },
  phpmyadmin: { installed: true, version: '5.2.1' },
  node: { installed: true, version: '18.19.1' },
  nvm: { installed: true, version: '0.40.1' },
};

const vhosts = [
  { domain: 'acme-shop.test', framework: 'Laravel + Inertia (React)', frameworkKey: 'laravel-react', docRoot: '/home/alex/projects/acme-shop/public', enabled: true },
  { domain: 'blog.test', framework: 'WordPress', frameworkKey: 'wordpress', docRoot: '/var/www/html/blog', enabled: true },
  { domain: 'client-portal.test', framework: 'Symfony', frameworkKey: 'symfony', docRoot: '/home/alex/projects/client-portal/public', enabled: true },
  { domain: 'intranet.test', framework: 'Drupal', frameworkKey: 'drupal', docRoot: '/var/www/html/intranet/web', enabled: true },
  { domain: 'legacy-crm.test', framework: 'CodeIgniter 4', frameworkKey: 'codeigniter', docRoot: '/var/www/html/legacy-crm/public', enabled: false },
  { domain: 'api.test', framework: 'Slim', frameworkKey: 'slim', docRoot: '/home/alex/projects/api/public', enabled: true },
];

contextBridge.exposeInMainWorld('api', {
  isRoot: async () => true,
  getOsInfo: async () => ({ name: 'Ubuntu', version: '24.04.1 LTS (Noble Numbat)', id: 'ubuntu', prettyName: 'Ubuntu 24.04.1 LTS', isUbuntu: true }),
  checkStack: async () => stack,
  chooseFolder: async () => null,
  getVersion: () => ipcRenderer.invoke('screenshots:getVersion'),
  openExternal: ok,

  install: {
    aptUpdate: ok, apache: ok, php: ok, nodeApt: ok, nvm: ok, mysql: ok, phpmyadmin: ok,
    onProgress: () => {}, onLog: () => {},
  },

  vhost: {
    list: async () => vhosts,
    create: ok,
    inspect: async () => ({ ok: false }),
    delete: ok,
    setEnabled: ok,
  },

  vhostGroups: {
    get: async () => ({
      user: 'alex',
      canEditGroups: true,
      groups: [
        { id: 'clients', name: 'Client projects', domains: ['acme-shop.test', 'client-portal.test'] },
        { id: 'internal', name: 'Internal', domains: ['intranet.test', 'legacy-crm.test'] },
      ],
      defaultFilter: 'all',
      hidden: [],
    }),
    saveGroups: ok,
    saveView: ok,
  },

  site: {
    frameworks: () => ipcRenderer.invoke('screenshots:frameworks'),
    detect: async () => ({ ok: true, empty: true }),
    onLog: () => {},
  },

  users: {
    list: async () => [
      { name: 'alex', uid: 1000, groups: ['alex', 'sudo', 'www-data', 'nvm'] },
      { name: 'sam', uid: 1001, groups: ['sam', 'www-data'] },
      { name: 'deploy', uid: 1002, groups: ['deploy', 'www-data', 'nvm'] },
      { name: 'guest', uid: 1003, groups: ['guest'] },
    ],
    addToGroup: ok, removeFromGroup: ok, create: ok,
  },

  permissions: {
    scan: async (target) => ({
      ok: true,
      target,
      clean: false,
      dirCount: 1284,
      fileCount: 9731,
      dirMismatchCount: 12,
      fileMismatchCount: 57,
      ownerMismatchCount: 23,
      dirMismatches: [
        '/var/www/html/blog/wp-content/uploads/2026/09',
        '/var/www/html/blog/wp-content/cache',
        '/var/www/html/legacy-crm/writable/session',
      ],
      fileMismatches: [
        '/var/www/html/blog/wp-config.php',
        '/var/www/html/blog/.htaccess',
        '/var/www/html/intranet/web/sites/default/settings.php',
        '/var/www/html/legacy-crm/.env',
        '/var/www/html/legacy-crm/writable/logs/log-2026-09-26.log',
      ],
      ownerMismatches: [
        '/var/www/html/blog/wp-content/uploads/2026/09/hero.jpg',
        '/var/www/html/intranet/web/sites/default/files/logo.png',
      ],
    }),
    fix: ok,
  },

  services: {
    status: async (service) => ({ active: service === 'apache2' || service === 'mysql', enabled: service === 'apache2' }),
    control: ok,
    setEnabledOnBoot: ok,
  },

  autostart: {
    get: async () => true,
    set: ok,
  },
});
