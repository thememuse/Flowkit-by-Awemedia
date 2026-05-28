'use strict';

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

function createTray({ getIconPath, onShow, onQuit, getPythonStatus, onRestartPython, onOpenBrowser, onCloseBrowser, getBrowserStatus }) {
  const resourcesPath = app.isPackaged
    ? path.join(process.resourcesPath, 'resources')
    : path.join(__dirname, '..', 'build', 'resources');

  const trayIconCandidates = [
    path.join(resourcesPath, 'tray-icon.png'),
    path.join(resourcesPath, 'icon.png'),
  ];

  let trayIconPath = null;
  for (const candidate of trayIconCandidates) {
    if (fs.existsSync(candidate)) { trayIconPath = candidate; break; }
  }

  let trayImage;
  if (trayIconPath) {
    trayImage = nativeImage.createFromPath(trayIconPath);
    if (process.platform === 'darwin') {
      trayImage = trayImage.resize({ width: 16, height: 16 });
      trayImage.setTemplateImage(true);
    } else {
      trayImage = trayImage.resize({ width: 16, height: 16 });
    }
  } else {
    trayImage = nativeImage.createEmpty();
  }

  const tray = new Tray(trayImage);
  tray.setToolTip('Flow Kit — AI Video Studio');

  function buildMenu() {
    const pyStatus = getPythonStatus?.() || {};
    const browserStatus = getBrowserStatus?.() || {};

    const agentLabel = pyStatus.healthy
      ? '● Agent đang chạy'
      : pyStatus.running
        ? '◌ Agent đang khởi động...'
        : '○ Agent đã dừng';

    const browserLabel = browserStatus.open
      ? (browserStatus.loggedIn ? '● Đã đăng nhập Google Flow' : '◌ Trình duyệt đang mở')
      : '○ Trình duyệt đã đóng';

    const template = [
      {
        label: 'Flow Kit',
        enabled: false,
      },
      { type: 'separator' },
      // Trạng thái
      { label: agentLabel, enabled: false },
      { label: browserLabel, enabled: false },
      { type: 'separator' },
      // Hành động
      {
        label: 'Mở Flow Kit',
        click: onShow,
        accelerator: process.platform === 'darwin' ? 'Command+Shift+F' : 'Ctrl+Shift+F',
      },
      {
        label: browserStatus.open ? 'Focus Google Flow' : 'Mở Google Flow',
        click: () => onOpenBrowser?.('https://labs.google/fx/tools/flow'),
      },
      ...(browserStatus.open ? [{
        label: 'Đóng trình duyệt',
        click: () => onCloseBrowser?.(),
      }] : []),
      { type: 'separator' },
      {
        label: 'Khởi động lại Python Agent',
        click: () => {
          onRestartPython?.();
          setTimeout(() => tray.setContextMenu(buildMenu()), 2000);
        },
      },
      { type: 'separator' },
      {
        label: 'Giới thiệu Flow Kit',
        click: () => {
          const { dialog } = require('electron');
          dialog.showMessageBox({
            type: 'info',
            title: 'Về Flow Kit',
            message: 'Flow Kit',
            detail: `Phiên bản ${app.getVersion()}\n\nPhần mềm sản xuất video AI\nHỗ trợ bởi Google Flow`,
            buttons: ['Đóng'],
          });
        },
      },
      { type: 'separator' },
      {
        label: 'Thoát Flow Kit',
        click: onQuit,
        accelerator: process.platform === 'darwin' ? 'Command+Q' : 'Alt+F4',
      },
    ];

    return Menu.buildFromTemplate(template);
  }

  tray.setContextMenu(buildMenu());
  tray.on('double-click', onShow);
  tray.on('click', () => { if (process.platform !== 'darwin') onShow(); });

  // Cập nhật menu mỗi 5 giây
  const updateInterval = setInterval(() => {
    if (!tray.isDestroyed()) {
      tray.setContextMenu(buildMenu());
    } else {
      clearInterval(updateInterval);
    }
  }, 5000);

  return tray;
}

module.exports = { createTray };
