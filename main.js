const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');

const { isRoot } = require('./backend/exec');
const system = require('./backend/system');
const mysql = require('./backend/mysql');
const phpmyadmin = require('./backend/phpmyadmin');
const nodejs = require('./backend/nodejs');
const apache = require('./backend/apache');
const users = require('./backend/users');
const permissions = require('./backend/permissions');
const services = require('./backend/services');
const autostart = require('./backend/autostart');
const frameworks = require('./backend/frameworks');
const vhostFilters = require('./backend/vhostFilters');

if (isRoot()) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
}

const ICON_PATH = path.join(__dirname, 'build', 'icon.png');
const startHidden = process.argv.includes('--hidden');

let mainWindow;
let tray;
let isQuitting = false;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'Lampstand',
    icon: ICON_PATH,
    show: !startHidden,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Closing the window minimizes to the tray instead of quitting, so the
  // tray icon stays a meaningful "app is running" indicator. Real exit goes
  // through the tray's Quit item (or app.quit() from there).
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });
}

function createTray() {
  const trayIcon = nativeImage.createFromPath(ICON_PATH).resize({ width: 22, height: 22, quality: 'best' });
  tray = new Tray(trayIcon);
  tray.setToolTip('Lampstand');

  const menu = Menu.buildFromTemplate([
    { label: 'Open Lampstand', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => { mainWindow.show(); mainWindow.focus(); });
}

/**
 * Command to relaunch Lampstand for the "launch at login" autostart entry.
 * Always unprivileged (no pkexec/sudo) and starts hidden to the tray, so
 * login isn't interrupted by a password prompt or a popping window.
 */
function getAutostartExecLine() {
  if (process.env.APPIMAGE) return `"${process.env.APPIMAGE}" --hidden %U`;
  if (app.isPackaged) return `"${process.execPath}" --hidden %U`;
  return `"${process.execPath}" "${__dirname}" --hidden %U`;
}

app.whenReady().then(() => {
  createWindow();
  createTray();
});

app.on('before-quit', () => { isQuitting = true; });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function sendProgress(channel, payload) {
  if (mainWindow) mainWindow.webContents.send(channel, payload);
}

function requireRoot() {
  if (!isRoot()) {
    throw new Error('This action requires root privileges. Please restart Lampstand with sudo/pkexec.');
  }
}

// ---- generic ----
ipcMain.handle('app:isRoot', () => isRoot());
ipcMain.handle('app:getOsInfo', () => system.getOsInfo());
ipcMain.handle('app:checkStack', () => system.checkStack());
ipcMain.handle('dialog:chooseFolder', async () => {
  const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
  if (res.canceled || !res.filePaths.length) return null;
  return res.filePaths[0];
});

// ---- install pipeline ----
ipcMain.handle('install:aptUpdate', async () => {
  requireRoot();
  return system.aptUpdate((evt) => sendProgress('install:log', { step: 'apt-update', ...evt }));
});

ipcMain.handle('install:apache', async () => {
  requireRoot();
  return system.installApache(
    (p) => sendProgress('install:progress', { step: 'apache', ...p }),
    (evt) => sendProgress('install:log', { step: 'apache', ...evt })
  );
});

ipcMain.handle('install:php', async () => {
  requireRoot();
  return system.installPhp(
    (p) => sendProgress('install:progress', { step: 'php', ...p }),
    (evt) => sendProgress('install:log', { step: 'php', ...evt })
  );
});

ipcMain.handle('install:nodeApt', async () => {
  requireRoot();
  return nodejs.installNodeApt(
    (p) => sendProgress('install:progress', { step: 'node', ...p }),
    (evt) => sendProgress('install:log', { step: 'node', ...evt })
  );
});

ipcMain.handle('install:nvm', async () => {
  requireRoot();
  return nodejs.installNvmSystemWide((evt) => sendProgress('install:log', { step: 'nvm', ...evt }));
});

ipcMain.handle('install:mysql', async (evt, { rootPassword }) => {
  requireRoot();
  const install = await mysql.installMysql(
    (p) => sendProgress('install:progress', { step: 'mysql', ...p }),
    (e) => sendProgress('install:log', { step: 'mysql', ...e })
  );
  if (!install.ok) return install;

  await mysql.waitForMysql();
  const secure = await mysql.secureInstall(rootPassword);
  return { ok: install.ok && secure.ok, stdout: secure.stdout, stderr: secure.stderr };
});

ipcMain.handle('install:phpmyadmin', async (evt, { mysqlRootPassword, appPassword }) => {
  requireRoot();
  return phpmyadmin.installPhpMyAdmin(
    mysqlRootPassword,
    appPassword,
    (p) => sendProgress('install:progress', { step: 'phpmyadmin', ...p }),
    (e) => sendProgress('install:log', { step: 'phpmyadmin', ...e })
  );
});

// ---- vhosts ----
ipcMain.handle('vhost:list', () => apache.listVhosts());
ipcMain.handle('vhost:create', async (evt, opts) => {
  requireRoot();
  const onData = (e) => sendProgress('site:log', e);
  const site = await frameworks.prepareSite(opts, onData);
  if (!site.ok) return site;
  onData({ stream: 'stdout', line: 'Creating Apache virtual host...', kind: 'stage' });
  const vhost = await apache.createVhost(opts.domain, site.docRoot, {
    frameworkLabel: site.label,
    frameworkKey: site.framework,
    projectDir: opts.projectDir.replace(/\/+$/, ''),
  });
  if (!vhost.ok) return vhost;
  return { ok: true, docRoot: site.docRoot, framework: site.label, notes: [...site.notes, ...vhost.warnings] };
});
ipcMain.handle('site:frameworks', () => frameworks.listFrameworks());
ipcMain.handle('site:detect', (evt, { dir }) => frameworks.detect(dir));
ipcMain.handle('vhost:inspect', (evt, { domain }) => apache.inspectVhost(domain));
ipcMain.handle('vhost:delete', (evt, { domain, ...opts }) => {
  requireRoot();
  return apache.deleteVhost(domain, opts, (e) => sendProgress('site:log', e));
});
ipcMain.handle('vhost:setEnabled', (evt, { domain, enabled }) => {
  requireRoot();
  return apache.setVhostEnabled(domain, enabled);
});
ipcMain.handle('vhostGroups:get', () => vhostFilters.get());
ipcMain.handle('vhostGroups:saveGroups', (evt, { groups }) => {
  requireRoot();
  return vhostFilters.saveGroups(groups);
});
ipcMain.handle('vhostGroups:saveView', (evt, { view }) => vhostFilters.saveView(view));

// ---- users ----
ipcMain.handle('users:list', () => users.listUsersWithGroups());
ipcMain.handle('users:addToGroup', (evt, { username, group }) => {
  requireRoot();
  return users.addUserToGroup(username, group);
});
ipcMain.handle('users:removeFromGroup', (evt, { username, group }) => {
  requireRoot();
  return users.removeUserFromGroup(username, group);
});
ipcMain.handle('users:create', (evt, { username, password }) => {
  requireRoot();
  return users.createUser(username, password);
});

// ---- permissions ----
ipcMain.handle('permissions:scan', (evt, { target }) => permissions.scan(target));
ipcMain.handle('permissions:fix', (evt, { target, setgid }) => {
  requireRoot();
  return permissions.fix(target, { setgid });
});

// ---- services ----
ipcMain.handle('services:status', (evt, { service }) => services.status(service));
ipcMain.handle('services:control', (evt, { service, action }) => {
  requireRoot();
  return services.control(service, action);
});
ipcMain.handle('services:setEnabledOnBoot', (evt, { service, enabled }) => {
  requireRoot();
  return services.setEnabledOnBoot(service, enabled);
});

// ---- autostart (launch Lampstand at login) ----
ipcMain.handle('autostart:get', () => autostart.isEnabled());
ipcMain.handle('autostart:set', (evt, { enabled }) => {
  const execLine = getAutostartExecLine();
  const iconPath = app.isPackaged ? 'lampstand' : ICON_PATH;
  return autostart.setEnabled(enabled, execLine, iconPath);
});
