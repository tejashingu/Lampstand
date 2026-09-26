// Regenerates docs/screenshots/*.png from the real UI, using made-up sample data
// (see mock-preload.js) so nothing on this machine is read or changed.
//
//   npx electron scripts/screenshots/main.js
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const OUT_DIR = path.join(ROOT, 'docs', 'screenshots');
const WIDTH = 1280;
const HEIGHT = 800;

const { listFrameworks } = require(path.join(ROOT, 'backend', 'frameworks'));
ipcMain.handle('screenshots:frameworks', () => listFrameworks());
ipcMain.handle('screenshots:getVersion', () => require(path.join(ROOT, 'package.json')).version);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function openWindow() {
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'mock-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      offscreen: true,
    },
  });
  win.webContents.setFrameRate(30);
  await win.loadFile(path.join(ROOT, 'renderer', 'index.html'));
  await wait(800);
  return win;
}

async function capture(win, name) {
  await wait(600);
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT_DIR, `${name}.png`), image.toPNG());
  console.log(`wrote docs/screenshots/${name}.png`);
}

async function tab(win, key, after = '') {
  await win.webContents.executeJavaScript(`Dashboard.setActiveTab('${key}'); ${after}`);
  await wait(600);
}

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const win = await openWindow();
  await capture(win, 'overview');

  await tab(win, 'vhosts');
  await win.webContents.executeJavaScript(`
    (() => {
      const cards = document.querySelectorAll('#dashboardContent .card');
      cards[cards.length - 1].scrollIntoView({ block: 'start' });
    })();
  `);
  await capture(win, 'virtual-hosts');

  await tab(win, 'users');
  await capture(win, 'users-groups');

  await tab(win, 'permissions');
  await win.webContents.executeJavaScript(`
    [...document.querySelectorAll('#dashboardContent button')].find((b) => b.textContent === 'Scan').click();
  `);
  await capture(win, 'permissions');

  await tab(win, 'services');
  await capture(win, 'services');

  await tab(win, 'about');
  await capture(win, 'about');

  await win.webContents.executeJavaScript('Wizard.start()');
  await capture(win, 'setup-wizard');

  app.quit();
});
