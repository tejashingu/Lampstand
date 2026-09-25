const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('api', {
  isRoot: () => invoke('app:isRoot'),
  getOsInfo: () => invoke('app:getOsInfo'),
  checkStack: () => invoke('app:checkStack'),
  chooseFolder: () => invoke('dialog:chooseFolder'),

  install: {
    aptUpdate: () => invoke('install:aptUpdate'),
    apache: () => invoke('install:apache'),
    php: () => invoke('install:php'),
    nodeApt: () => invoke('install:nodeApt'),
    nvm: () => invoke('install:nvm'),
    mysql: (rootPassword) => invoke('install:mysql', { rootPassword }),
    phpmyadmin: (mysqlRootPassword, appPassword) =>
      invoke('install:phpmyadmin', { mysqlRootPassword, appPassword }),
    onProgress: (cb) => {
      ipcRenderer.on('install:progress', (evt, payload) => cb(payload));
    },
    onLog: (cb) => {
      ipcRenderer.on('install:log', (evt, payload) => cb(payload));
    },
  },

  vhost: {
    list: () => invoke('vhost:list'),
    // opts: { domain, projectDir, mode: 'existing'|'install', framework, mysqlRootPassword, fixPermissions }
    create: (opts) => invoke('vhost:create', opts),
    inspect: (domain) => invoke('vhost:inspect', { domain }),
    // opts: { deleteFiles, dropDatabase, mysqlRootPassword }
    delete: (domain, opts = {}) => invoke('vhost:delete', { domain, ...opts }),
    setEnabled: (domain, enabled) => invoke('vhost:setEnabled', { domain, enabled }),
  },

  site: {
    frameworks: () => invoke('site:frameworks'),
    detect: (dir) => invoke('site:detect', { dir }),
    onLog: (cb) => {
      ipcRenderer.on('site:log', (evt, payload) => cb(payload));
    },
  },

  users: {
    list: () => invoke('users:list'),
    addToGroup: (username, group) => invoke('users:addToGroup', { username, group }),
    removeFromGroup: (username, group) => invoke('users:removeFromGroup', { username, group }),
    create: (username, password) => invoke('users:create', { username, password }),
  },

  permissions: {
    scan: (target) => invoke('permissions:scan', { target }),
    fix: (target, setgid) => invoke('permissions:fix', { target, setgid }),
  },

  services: {
    status: (service) => invoke('services:status', { service }),
    control: (service, action) => invoke('services:control', { service, action }),
    setEnabledOnBoot: (service, enabled) => invoke('services:setEnabledOnBoot', { service, enabled }),
  },

  autostart: {
    get: () => invoke('autostart:get'),
    set: (enabled) => invoke('autostart:set', { enabled }),
  },
});
