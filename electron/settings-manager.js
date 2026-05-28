'use strict';

/**
 * SettingsManager — Quản lý cài đặt ứng dụng.
 *
 * Lưu vào: ~/Library/Application Support/flowkit/settings.json (macOS)
 *           %APPDATA%/flowkit/settings.json (Windows)
 *
 * Đồng bộ với agent qua REST API /api/settings mỗi khi thay đổi.
 */

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const DEFAULTS = {
  anthropicApiKey: '',
  sunoApiKey: '',
  defaultMaterial: 'realistic',
  defaultOrientation: 'VERTICAL',
  defaultSceneCount: 10,
  maxConcurrentRequests: 5,
  apiCooldown: 10,
  reviewModel: 'claude-haiku-4-5-20251001',
  language: 'vi',
};

class SettingsManager {
  constructor() {
    this._file = null;
    this._cache = null;
  }

  _getFile() {
    if (!this._file) {
      const userDataPath = app.getPath('userData');
      this._file = path.join(userDataPath, 'settings.json');
    }
    return this._file;
  }

  _read() {
    try {
      const file = this._getFile();
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (_) {}
    return {};
  }

  _write(data) {
    try {
      fs.writeFileSync(this._getFile(), JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[Settings] Failed to write settings:', e.message);
    }
  }

  getAll() {
    if (!this._cache) {
      this._cache = { ...DEFAULTS, ...this._read() };
    }
    return { ...this._cache };
  }

  get(key) {
    return this.getAll()[key];
  }

  set(key, value) {
    const current = this._read();
    current[key] = value;
    this._write(current);
    this._cache = { ...DEFAULTS, ...current };
    this._syncToAgent({ [key]: value }).catch(() => {});
    return this._cache;
  }

  setMany(updates) {
    const current = this._read();
    Object.assign(current, updates);
    this._write(current);
    this._cache = { ...DEFAULTS, ...current };
    this._syncToAgent(updates).catch(() => {});
    return this._cache;
  }

  /** Đồng bộ settings với Python agent qua REST API */
  async _syncToAgent(updates) {
    try {
      const { default: fetch } = await import('node-fetch').catch(() => ({ default: null }));
      const http = fetch || require('http');
      if (!fetch) return; // fallback không có

      await fetch('http://127.0.0.1:8100/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
        signal: AbortSignal.timeout(5000),
      });
    } catch (_) {
      // Agent có thể chưa sẵn sàng — không sao
    }
  }

  /** Reset về defaults */
  reset() {
    this._write({});
    this._cache = { ...DEFAULTS };
    return this._cache;
  }
}

const settingsManager = new SettingsManager();

module.exports = { settingsManager, SETTINGS_DEFAULTS: DEFAULTS };
