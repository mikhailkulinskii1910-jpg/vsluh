// Ковёр на рабочем столе: прозрачное окно во весь экран, сквозь которое
// проходят клики везде, кроме самого ковра.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, protocol, net, globalShortcut, dialog } = require('electron');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// своя схема вместо file://, иначе WebGL откажется брать картинку ковра как «чужую»
protocol.registerSchemesAsPrivileged([{ scheme: 'kovyor', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// на Linux прозрачность работает только так
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-transparent-visuals');
}

const statePath = () => path.join(app.getPath('userData'), 'state.json');
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

const DEFAULTS = { width: 320, shape: 'rect', opacity: 1, image: '', rollKey: 'Ctrl+Alt+R', fold: 'roll', onTop: false };
const OLD_SIZES = { small: 220, medium: 320, large: 440 };
let settings = { ...DEFAULTS };
try {
  const s = JSON.parse(fs.readFileSync(settingsPath(), 'utf8'));
  if (s.size && !s.width) s.width = OLD_SIZES[s.size];
  delete s.size;
  Object.assign(settings, s);
} catch (_) {}
const saveSettings = () => { try { fs.writeFileSync(settingsPath(), JSON.stringify(settings)); } catch (_) {} };

let win, tray, settingsWin, ignoring = null, dragging = false, cursorTimer, rollKeyOk = true;

function setIgnore(ignore) {
  if (!win || ignoring === ignore) return;
  ignoring = ignore;
  win.setIgnoreMouseEvents(ignore, { forward: true });
}

function createWindow() {
  const d = screen.getPrimaryDisplay();
  const b = d.workArea;
  win = new BrowserWindow({
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, resizable: false, movable: false,
    hasShadow: false, skipTaskbar: true, fullscreenable: false,
    minimizable: false, maximizable: false, alwaysOnTop: settings.onTop,
    backgroundColor: '#00000000', title: 'Kovyor',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.setVisibleOnAllWorkspaces?.(true);
  win.loadURL('kovyor://app/index.html');
  setIgnore(true);

  // Положение курсора опрашиваем сами: пересылка mousemove сквозь окно
  // есть не на всех системах (на Linux её нет совсем).
  let last = '';
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const wb = win.getBounds();
    const key = p.x + ',' + p.y;
    if (key === last) return;
    last = key;
    win.webContents.send('cursor', { x: p.x - wb.x, y: p.y - wb.y });
  }, 16);

  win.on('closed', () => { win = null; clearInterval(cursorTimer); });
}

function buildMenu() {
  const send = (cmd, arg) => win && win.webContents.send('command', cmd, arg);
  return Menu.buildFromTemplate([
    { label: 'Настройки…', click: openSettings },
    { label: 'Свернуть / развернуть', accelerator: rollKeyOk ? settings.rollKey : undefined, registerAccelerator: false, click: () => send('roll') },
    { type: 'separator' },
    { label: 'Расстелить ровно', click: () => send('flatten') },
    { label: 'Встряхнуть', click: () => send('shake') },
    { label: 'Скомкать', click: () => send('crumple') },
    { label: 'Вернуть в центр', click: () => send('reset') },
    { type: 'separator' },
    { label: 'Убрать ковёр (или удерживать Esc 3 с)', click: () => win ? win.webContents.send('command', 'remove') : app.quit() },
  ]);
}

function openSettings() {
  if (settingsWin) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 780, height: 650, useContentSize: true, resizable: false, maximizable: false, minimizable: true, fullscreenable: false,
    title: 'Ковёр — настройки', backgroundColor: '#17161a', autoHideMenuBar: true, show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js') },
  });
  settingsWin.setMenu(null);
  settingsWin.loadURL('kovyor://app/settings.html');
  settingsWin.once('ready-to-show', () => settingsWin.show());
  settingsWin.on('closed', () => { settingsWin = null; });
}

// клавиша сворачивания в рулон работает из любого окна
function registerRollKey() {
  for (const k of registeredRoll) { try { globalShortcut.unregister(k); } catch (_) {} }
  registeredRoll = [];
  rollKeyOk = false;
  if (!settings.rollKey) return true;
  try { rollKeyOk = globalShortcut.register(settings.rollKey, () => win && win.webContents.send('command', 'roll')); } catch (_) { rollKeyOk = false; }
  if (rollKeyOk) registeredRoll.push(settings.rollKey);
  return rollKeyOk;
}
let registeredRoll = [];

function applySettings(patch) {
  const prevKey = settings.rollKey;
  Object.assign(settings, patch);
  let keyError = '';
  if ('rollKey' in patch && patch.rollKey !== prevKey) {
    if (!registerRollKey()) {
      keyError = 'Эту комбинацию занял Windows или другая программа — выберите другую.';
      settings.rollKey = prevKey; registerRollKey();
    }
  }
  if ('onTop' in patch && win) win.setAlwaysOnTop(!!settings.onTop, 'floating');
  saveSettings();
  win && win.webContents.send('settings', settings);
  refreshMenus();
  return { settings, keyError, autostart: app.getLoginItemSettings().openAtLogin };
}

function refreshMenus() { tray && tray.setContextMenu(buildMenu()); }

app.whenReady().then(() => {
  protocol.handle('kovyor', (req) => {
    const u = new URL(req.url);
    // kovyor://app/… — файлы программы, kovyor://user/… — своя картинка ковра из папки настроек
    const root = u.host === 'user' ? app.getPath('userData') : __dirname;
    const file = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
    if (!file.startsWith(root + path.sep)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  registerRollKey();
  if (process.argv.includes('--settings')) setTimeout(openSettings, 300);
  createWindow();
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Ковёр — тащите мышью, колесо меняет высоту подъёма, Esc 3 секунды — убрать');
  tray.on('double-click', openSettings);
  refreshMenus();

  screen.on('display-metrics-changed', () => {
    if (!win) return;
    const b = screen.getPrimaryDisplay().workArea;
    win.setBounds(b);
  });
});

// повторный запуск ярлыка, когда ковёр уже лежит, открывает настройки
app.on('second-instance', () => openSettings());
app.on('window-all-closed', () => app.quit());

ipcMain.on('hover', (_e, over) => { if (!dragging) setIgnore(!over); escWhileHover(over); });

// Убрать ковёр: удерживать Esc ~3 секунды. Пока курсор над ковром, Esc ловится и без фокуса
// (по автоповтору клавиши), а когда окно в фокусе — renderer сам видит нажатие и отпускание.
const ESC_HOLD = 3000;
let escFirst = 0, escLast = 0, escTimer = null;
function escWhileHover(over) {
  if (over && !globalShortcut.isRegistered('Escape')) globalShortcut.register('Escape', onEscRepeat);
  else if (!over && globalShortcut.isRegistered('Escape')) { globalShortcut.unregister('Escape'); escReset(); }
}
function escReset() {
  escFirst = 0; clearInterval(escTimer); escTimer = null;
  win && win.webContents.send('esc', 0);
}
function onEscRepeat() {
  const now = Date.now();
  if (!escFirst || now - escLast > 700) escFirst = now;
  escLast = now;
  if (!escTimer) escTimer = setInterval(() => {
    const t = Date.now();
    if (t - escLast > 700) return escReset();          // клавишу отпустили
    const k = (t - escFirst) / ESC_HOLD;
    win && win.webContents.send('esc', Math.min(1, k));
    if (k >= 1) { clearInterval(escTimer); escTimer = null; }
  }, 30);
}
ipcMain.on('quit', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
ipcMain.on('drag', (_e, on) => { dragging = on; if (on) setIgnore(false); });
ipcMain.on('menu', () => win && buildMenu().popup({ window: win }));
ipcMain.handle('init', () => {
  let state = null;
  try { state = JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch (_) {}
  return { settings, state };
});
ipcMain.on('save-state', (_e, s) => { try { fs.writeFileSync(statePath(), JSON.stringify(s)); } catch (_) {} });

// ---------- окно настроек ----------
ipcMain.handle('settings:get', () => ({ settings, autostart: app.getLoginItemSettings().openAtLogin, rollKeyOk }));
ipcMain.handle('settings:set', (_e, patch) => applySettings(patch || {}));
ipcMain.handle('settings:autostart', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on }); return app.getLoginItemSettings().openAtLogin; });
ipcMain.handle('settings:roll', () => { win && win.webContents.send('command', 'roll'); });
ipcMain.handle('settings:pick-image', async () => {
  const r = await dialog.showOpenDialog(settingsWin || win, {
    title: 'Картинка для ковра', properties: ['openFile'],
    filters: [{ name: 'Картинки', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0], name = 'carpet-' + Date.now() + path.extname(src).toLowerCase();
  const dir = app.getPath('userData');
  fs.copyFileSync(src, path.join(dir, name));
  // старые свои картинки больше не нужны
  for (const f of fs.readdirSync(dir)) if (/^carpet-\d+\./.test(f) && f !== name) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) {} }
  return applySettings({ image: name });
});
