'use strict';

const { app, BrowserWindow, ipcMain, Menu, Tray, shell, dialog, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { PythonManager } = require('./python-manager');
const { BrowserManager } = require('./browser-manager');
const { createTray } = require('./tray');
const { settingsManager } = require('./settings-manager');
const { licenseManager } = require('./license-manager');

// Bỏ qua proxy toàn hệ thống cho local address để tránh kết nối 127.0.0.1/localhost bị chuyển hướng/chặn bởi VPN/Proxy
app.commandLine.appendSwitch('proxy-bypass-list', '127.0.0.1,localhost,::1,<local>');

// ─── Hằng số ─────────────────────────────────────────────
const isDev = process.env.FLOWKIT_DEV === '1';
const RENDERER_URL = isDev ? 'http://localhost:5173' : null;
const RENDERER_HTML = path.join(__dirname, '..', 'dashboard', 'dist', 'index.html');

// ─── Fix EPIPE — bỏ qua lỗi ghi stdout/stderr ────────────
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') return; });
process.stderr.on('error', (err) => { if (err.code === 'EPIPE') return; });

// ─── State ───────────────────────────────────────────────
let mainWindow = null;
let tray = null;
let pythonManager = null;
let browserManager = null;
let isQuitting = false;

// ─── Single Instance Lock ─────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ─── Tạo cửa sổ chính ────────────────────────────────────
function createWindow() {
  const iconPath = getIconPath();

  // Set dock icon on macOS in development using PNG which is much more reliable for dynamic setIcon
  if (process.platform === 'darwin') {
    const resourcesPath = app.isPackaged
      ? path.join(process.resourcesPath, 'resources')
      : path.join(__dirname, '..', 'build', 'resources');
    const pngIconPath = path.join(resourcesPath, 'icon.png');
    if (fs.existsSync(pngIconPath)) {
      try {
        app.dock.setIcon(nativeImage.createFromPath(pngIconPath));
      } catch (err) {
        safeLog(`[Main] Failed to set macOS dock icon: ${err.message}`);
      }
    }
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 920,
    minHeight: 620,
    title: 'Flow Kit',
    icon: iconPath,
    backgroundColor: '#0d0d1a',
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: !isDev,
    },
  });

  if (isDev && RENDERER_URL) {
    mainWindow.loadURL(RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(RENDERER_HTML);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Ẩn vào tray thay vì đóng (macOS)
  mainWindow.on('close', (e) => {
    if (!isQuitting && process.platform === 'darwin') {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Mở link ngoài trong browser mặc định
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (e, url) => {
    try {
      const parsed = new URL(url);
      if (parsed.origin !== 'http://localhost:5173' && !url.startsWith('file://')) {
        e.preventDefault();
        shell.openExternal(url);
      }
    } catch (_) {}
  });

  return mainWindow;
}

// ─── Icon helper ─────────────────────────────────────────
function getIconPath() {
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '..', 'build', 'resources');

  if (process.platform === 'darwin') return path.join(resourcesPath, 'icon.icns');
  if (process.platform === 'win32') return path.join(resourcesPath, 'icon.ico');
  return path.join(resourcesPath, 'icon.png');
}

// ─── Gửi sự kiện tới renderer ────────────────────────────
function forwardToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// ─── IPC Handlers ────────────────────────────────────────
function setupIPC() {
  // ── Python Agent ──
  ipcMain.handle('python:status', () => pythonManager?.getStatus() ?? { running: false, healthy: false, pid: null });
  ipcMain.handle('python:restart', async () => {
    try { await pythonManager?.restart(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  // ── Browser (Trình duyệt) ──
  ipcMain.handle('browser:open', async (_, url) => {
    try {
      await browserManager?.open(url);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('browser:close', async () => {
    try { await browserManager?.close(); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('browser:status', () => {
    return browserManager?.getStatus() ?? { open: false, url: null, loggedIn: false };
  });

  ipcMain.handle('browser:clearSession', async () => {
    try {
      await browserManager?.clearSession();
      return { ok: true };
    } catch (e) { return { ok: false, error: e.message }; }
  });

  // ── App ──
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:openExternal', (_, url) => shell.openExternal(url));
  ipcMain.handle('app:showOpenDialog', (_, opts) => dialog.showOpenDialog(mainWindow, opts));
  ipcMain.handle('app:showSaveDialog', (_, opts) => dialog.showSaveDialog(mainWindow, opts));
  ipcMain.handle('app:revealFile', (_, filePath) => shell.showItemInFolder(filePath));

  // ── Cài đặt (Settings) ──
  ipcMain.handle('settings:getAll', () => settingsManager.getAll());
  ipcMain.handle('settings:get', (_, key) => settingsManager.get(key));
  ipcMain.handle('settings:set', (_, key, value) => settingsManager.set(key, value));
  ipcMain.handle('settings:setMany', (_, updates) => settingsManager.setMany(updates));
  ipcMain.handle('settings:reset', () => settingsManager.reset());

  // ── Window ──
  ipcMain.handle('window:minimize', () => mainWindow?.minimize());
  ipcMain.handle('window:hide', () => mainWindow?.hide());

  // ── Bản quyền (License) ──
  ipcMain.handle('license:getMachineId', () => licenseManager.getMachineId());
  ipcMain.handle('license:getStatus', () => licenseManager.getStatus());
  ipcMain.handle('license:activate', (_, key) => licenseManager.activate(key));
}

// ─── Khởi chạy app ───────────────────────────────────────
app.whenReady().then(async () => {
  setupIPC();

  // Khởi tạo Python Manager
  pythonManager = new PythonManager({
    onLog: (line) => forwardToRenderer('python:log', line),
    onStatusChange: (status) => forwardToRenderer('python:status-change', status),
    onReady: () => forwardToRenderer('python:ready', null),
    onError: (err) => forwardToRenderer('python:error', err),
  });

  // Khởi tạo Browser Manager
  browserManager = new BrowserManager({
    onLog: (line) => forwardToRenderer('python:log', `[Trình duyệt] ${line}`),
    onStatusChange: (status) => forwardToRenderer('browser:status-change', status),
  });

  // Tạo cửa sổ chính
  createWindow();

  // Tạo system tray
  tray = createTray({
    getIconPath,
    onShow: () => { mainWindow?.show(); mainWindow?.focus(); },
    onQuit: () => { isQuitting = true; app.quit(); },
    getPythonStatus: () => pythonManager?.getStatus(),
    onRestartPython: () => pythonManager?.restart(),
    onOpenBrowser: () => browserManager?.open(),
    onCloseBrowser: () => browserManager?.close(),
    getBrowserStatus: () => browserManager?.getStatus(),
  });

  // Khởi động Python agent
  try {
    await pythonManager.start();
  } catch (err) {
    safeLog(`[Main] Lỗi khởi động Python: ${err.message}`);
    forwardToRenderer('python:error', err.message);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
});

// ─── Xử lý thoát ─────────────────────────────────────────
app.on('before-quit', async (e) => {
  if (!isQuitting) {
    isQuitting = true;
    e.preventDefault();
    try {
      await Promise.all([
        pythonManager?.stop(),
        browserManager?.close(),
      ]);
    } finally {
      app.quit();
    }
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    isQuitting = true;
    Promise.all([
      pythonManager?.stop(),
      browserManager?.close(),
    ]).finally(() => app.quit());
  }
});

// ─── Xử lý lỗi toàn cục ─────────────────────────────────
function safeLog(msg) {
  try { process.stdout.write(msg + '\n'); } catch (_) {}
}

process.on('uncaughtException', (err) => {
  // Bỏ qua EPIPE errors
  if (err.code === 'EPIPE') return;
  safeLog(`[Lỗi không xử lý] ${err.message}`);
  dialog.showErrorBox('Flow Kit — Lỗi', `Lỗi không mong muốn: ${err.message}`);
});

process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  if (msg.includes('EPIPE')) return;
  safeLog(`[Promise không xử lý] ${msg}`);
});
