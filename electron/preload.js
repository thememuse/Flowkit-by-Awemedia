'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * Preload — expose IPC APIs an toàn tới renderer qua contextBridge.
 * Renderer truy cập qua window.electronAPI.*
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Python Agent ──────────────────────────────────────
  getPythonStatus: () => ipcRenderer.invoke('python:status'),
  restartPython: () => ipcRenderer.invoke('python:restart'),

  onPythonLog: (cb) => {
    const handler = (_, line) => cb(line);
    ipcRenderer.on('python:log', handler);
    return () => ipcRenderer.removeListener('python:log', handler);
  },
  onPythonStatusChange: (cb) => {
    const handler = (_, status) => cb(status);
    ipcRenderer.on('python:status-change', handler);
    return () => ipcRenderer.removeListener('python:status-change', handler);
  },
  onPythonReady: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('python:ready', handler);
    return () => ipcRenderer.removeListener('python:ready', handler);
  },
  onPythonError: (cb) => {
    const handler = (_, err) => cb(err);
    ipcRenderer.on('python:error', handler);
    return () => ipcRenderer.removeListener('python:error', handler);
  },

  // ── Trình duyệt (Browser) ─────────────────────────────
  openBrowser: (url) => ipcRenderer.invoke('browser:open', url),
  closeBrowser: () => ipcRenderer.invoke('browser:close'),
  getBrowserStatus: () => ipcRenderer.invoke('browser:status'),
  clearBrowserSession: () => ipcRenderer.invoke('browser:clearSession'),

  onBrowserStatusChange: (cb) => {
    const handler = (_, status) => cb(status);
    ipcRenderer.on('browser:status-change', handler);
    return () => ipcRenderer.removeListener('browser:status-change', handler);
  },

  // ── Cài đặt (Settings) ───────────────────────────────
  getSettings: () => ipcRenderer.invoke('settings:getAll'),
  getSetting: (key) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key, value) => ipcRenderer.invoke('settings:set', key, value),
  saveSettings: (updates) => ipcRenderer.invoke('settings:setMany', updates),
  resetSettings: () => ipcRenderer.invoke('settings:reset'),

  // ── Thông tin App ─────────────────────────────────────
  getVersion: () => ipcRenderer.invoke('app:version'),

  // ── Thao tác hệ thống ─────────────────────────────────
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  showOpenDialog: (options) => ipcRenderer.invoke('app:showOpenDialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('app:showSaveDialog', options),
  revealFile: (filePath) => ipcRenderer.invoke('app:revealFile', filePath),

  // ── Điều khiển cửa sổ ────────────────────────────────
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),

  // ── Bản quyền (License) ──────────────────────────────
  getMachineId: () => ipcRenderer.invoke('license:getMachineId'),
  getLicenseStatus: () => ipcRenderer.invoke('license:getStatus'),
  activateLicense: (key) => ipcRenderer.invoke('license:activate', key),

  // ── Thông tin nền tảng ────────────────────────────────
  platform: process.platform,
  isElectron: true,
});
