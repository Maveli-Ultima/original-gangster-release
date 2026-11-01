// Desktop shell: one window, the built game served from app://game/, saves on
// disk through a narrow IPC surface. `OG_DEV_URL` points it at the Vite dev
// server instead (npm run desktop:dev).
'use strict';
const { app, BrowserWindow, Menu, dialog, ipcMain, net, protocol, session, shell } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const saveStore = require('./saveStore.cjs');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.OG_DEV_URL;
const savesDir = () => path.join(app.getPath('userData'), 'saves');

// One profile folder for the packaged app and `electron .` alike (Electron
// would otherwise name it after package.json in one and productName in the
// other). Tests and portable setups can point it elsewhere.
app.setPath('userData', process.env.OG_USER_DATA || path.join(app.getPath('appData'), 'Original Gangster'));

// Laptops with two GPUs: render on the discrete one.
app.commandLine.appendSwitch('force_high_performance_gpu');

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

function serveDist() {
  protocol.handle('app', request => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 960, minWidth: 1024, minHeight: 640,
    backgroundColor: '#0b0b0d', show: false, autoHideMenuBar: true,
    title: 'Original Gangster',
    // The packaged exe carries the icon; this covers `electron .` runs.
    icon: path.join(DIST, 'art', 'brand', 'favicon-512.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // Never an invisible window holding the single-instance lock.
  setTimeout(() => { if (!win.isDestroyed() && !win.isVisible()) win.show(); }, 15000);
  // External links open in the user's browser; the game never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(DEV_URL ?? 'app://game/')) event.preventDefault();
  });
  if (app.isPackaged) {
    // The shipped game: no reload (it threw away the week), developer tools,
    // close-without-saving or page zoom from the browser's own shortcuts.
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = input.key.toLowerCase(), mod = input.control || input.meta;
      if (key === 'f5' || key === 'f12' || (mod && ['r', 'w', '+', '=', '-', '0'].includes(key)) ||
        (mod && input.shift && key === 'i')) event.preventDefault();
    });
  }
  // A crashed page is reloaded rather than left as a blank window.
  let crashes = 0;
  win.webContents.on('render-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit' || win.isDestroyed()) return;
    if (++crashes <= 2) { win.webContents.reload(); return; }
    dialog.showMessageBox(win, { type: 'error', title: 'Original Gangster',
      message: 'The game stopped unexpectedly. Your saved games are safe on disk.', buttons: ['Restart', 'Quit'] })
      .then(({ response }) => { if (response === 0) { crashes = 0; win.webContents.reload(); } else app.quit(); })
      .catch(() => app.quit());
  });
  win.loadURL(DEV_URL ?? 'app://game/index.html').catch(e => console.error('Could not load the game:', e));
  return win;
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    // Only our own page may touch the saves.
    // (URL.origin is "null" for custom schemes, so compare prefixes.)
    const from = event.senderFrame?.url ?? '';
    if (!from.startsWith('app://game/') && !(DEV_URL && from.startsWith(DEV_URL + '/'))) throw new Error('Refused.');
    return fn(...args);
  });
}

handle('saves:list', () => saveStore.listHeaders(savesDir()));
handle('saves:read', id => saveStore.readSlot(savesDir(), id));
handle('saves:write', (meta, worldJson) => saveStore.writeSlot(savesDir(), meta, worldJson));
handle('saves:remove', id => saveStore.removeSlot(savesDir(), id));
handle('saves:folder', () => savesDir());
handle('saves:reveal', () => shell.openPath(savesDir()));
// Main Menu Quit (manual p.29).
handle('app:quit', () => { app.quit(); });

// A second launch focuses the running game instead of opening another copy
// that would write the same save files.
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) { if (win.isMinimized()) win.restore(); win.show(); win.focus(); }
  });
  app.whenReady().then(() => {
    if (app.isPackaged) Menu.setApplicationMenu(null);
    // The game asks for nothing (camera, microphone, notifications...).
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    if (!DEV_URL) serveDist();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch(e => {
    console.error('Original Gangster could not start:', e);
    dialog.showErrorBox('Original Gangster', `The game could not start.\n\n${e instanceof Error ? e.message : e}`);
    app.quit();
  });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
