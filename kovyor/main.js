// Ковёр на рабочем столе: прозрачное окно во весь экран, сквозь которое
// проходят клики везде, кроме самого ковра.
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, protocol, net, globalShortcut } = require('electron');
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

let settings = { size: 'medium', onTop: false };
try { Object.assign(settings, JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))); } catch (_) {}
const saveSettings = () => { try { fs.writeFileSync(settingsPath(), JSON.stringify(settings)); } catch (_) {} };

let win, tray, ignoring = null, dragging = false, cursorTimer;

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
  const sizes = [['small', 'Маленький'], ['medium', 'Средний'], ['large', 'Большой']];
  return Menu.buildFromTemplate([
    { label: 'Расстелить ровно', click: () => send('flatten') },
    { label: 'Встряхнуть', click: () => send('shake') },
    { label: 'Скомкать', click: () => send('crumple') },
    { label: 'Вернуть в центр', click: () => send('reset') },
    { type: 'separator' },
    { label: 'Размер', submenu: sizes.map(([id, label]) => ({
      label, type: 'radio', checked: settings.size === id,
      click: () => { settings.size = id; saveSettings(); send('size', id); refreshMenus(); },
    })) },
    { label: 'Поверх всех окон', type: 'checkbox', checked: settings.onTop, click: (it) => {
      settings.onTop = it.checked; saveSettings();
      win && win.setAlwaysOnTop(settings.onTop, 'floating'); refreshMenus();
    } },
    { label: 'Запускать при входе в систему', type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (it) => { app.setLoginItemSettings({ openAtLogin: it.checked }); refreshMenus(); } },
    { type: 'separator' },
    { label: 'Убрать ковёр (или удерживать Esc 3 с)', click: () => win ? win.webContents.send('command', 'remove') : app.quit() },
  ]);
}

function refreshMenus() { tray && tray.setContextMenu(buildMenu()); }

app.whenReady().then(() => {
  protocol.handle('kovyor', (req) => {
    const file = path.normalize(path.join(__dirname, decodeURIComponent(new URL(req.url).pathname)));
    if (!file.startsWith(__dirname + path.sep)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Ковёр — тащите мышью, колесо меняет высоту подъёма, Esc 3 секунды — убрать');
  refreshMenus();

  screen.on('display-metrics-changed', () => {
    if (!win) return;
    const b = screen.getPrimaryDisplay().workArea;
    win.setBounds(b);
  });
});

app.on('second-instance', () => win && win.webContents.send('command', 'shake'));
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
