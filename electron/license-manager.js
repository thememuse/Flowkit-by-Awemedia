'use strict';

const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const crypto = require('crypto');
const os = require('os');

// Đường dẫn Cloudflare Worker quản lý License (Mặc định dùng domain workers của Flowkit)
const DEFAULT_LICENSE_SERVER = 'https://flowkit-license-server.netbase.workers.dev';

class LicenseManager {
  constructor() {
    this._licenseFile = null;
    this._cache = null;
  }

  _getLicenseFile() {
    if (!this._licenseFile) {
      const userDataPath = app.getPath('userData');
      this._licenseFile = path.join(userDataPath, 'license.json');
    }
    return this._licenseFile;
  }

  // Đọc dữ liệu license từ tệp cục bộ
  _readLocal() {
    try {
      const file = this._getLicenseFile();
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8');
        return JSON.parse(raw);
      }
    } catch (_) {}
    return null;
  }

  // Lưu dữ liệu license xuống tệp cục bộ
  _writeLocal(data) {
    try {
      fs.writeFileSync(this._getLicenseFile(), JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error('[License] Lỗi ghi dữ liệu license:', e.message);
    }
  }

  // Lấy Server URL từ cấu hình hoặc mặc định
  _getServerUrl() {
    try {
      const settingsFile = path.join(app.getPath('userData'), 'settings.json');
      if (fs.existsSync(settingsFile)) {
        const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
        if (settings.licenseServerUrl) {
          return settings.licenseServerUrl;
        }
      }
    } catch (_) {}
    return DEFAULT_LICENSE_SERVER;
  }

  // Sinh Mã máy duy nhất theo phần cứng (SHA-256 mã hóa để bảo mật)
  getMachineId() {
    let rawId = '';
    try {
      if (process.platform === 'darwin') {
        // macOS: IOPlatformUUID
        rawId = execSync('ioreg -rd1 -c IOPlatformExpertDevice | awk \'/IOPlatformUUID/ { split($0, line, "\\\""); print line[4] }\'', { timeout: 3000 }).toString().trim();
      } else if (process.platform === 'win32') {
        // Windows: BIOS UUID
        rawId = execSync('wmic csproduct get uuid', { timeout: 3000 }).toString().replace('UUID', '').trim();
      } else {
        // Linux: machine-id
        if (fs.existsSync('/etc/machine-id')) {
          rawId = fs.readFileSync('/etc/machine-id', 'utf8').trim();
        } else if (fs.existsSync('/var/lib/dbus/machine-id')) {
          rawId = fs.readFileSync('/var/lib/dbus/machine-id', 'utf8').trim();
        }
      }
    } catch (e) {
      // Fallback nếu lệnh hệ thống bị chặn
      rawId = os.hostname() + '-' + os.arch() + '-' + os.totalmem();
    }

    if (!rawId) {
      rawId = 'flowkit-fallback-' + os.userInfo().username;
    }

    // Trả về chuỗi hash SHA-256 có độ dài cố định 64 ký tự
    return crypto.createHash('sha256').update(rawId).digest('hex');
  }

  // API Kích hoạt License Online
  async activate(licenseKey) {
    const machineId = this.getMachineId();
    const serverUrl = this._getServerUrl();

    try {
      const response = await fetch(`${serverUrl}/api/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey, machine_id: machineId }),
        signal: AbortSignal.timeout(10000), // timeout 10 giây
      });

      const resData = await response.json();

      if (!response.ok) {
        return { ok: false, error: resData.error || 'Yêu cầu kích hoạt bị máy chủ từ chối!' };
      }

      // Kích hoạt thành công -> Lưu cache cục bộ
      const licenseInfo = {
        licenseKey,
        machineId,
        durationType: resData.durationType,
        expiresAt: resData.expiresAt,
        activatedAt: new Date().toISOString(),
        lastCheckedAt: new Date().toISOString(),
        cachedActive: true,
      };

      this._writeLocal(licenseInfo);
      this._cache = licenseInfo;

      return { ok: true, durationType: resData.durationType, expiresAt: resData.expiresAt };
    } catch (err) {
      return { ok: false, error: `Không thể kết nối tới máy chủ kích hoạt bản quyền: ${err.message}` };
    }
  }

  // Lấy trạng thái License hiện tại (Tích hợp Offline Cache 24 giờ)
  async getStatus() {
    const local = this._readLocal();
    const machineId = this.getMachineId();

    if (!local || !local.licenseKey || local.machineId !== machineId) {
      // Không có cache cục bộ -> Kiểm tra xem máy này đã được kích hoạt trực tiếp từ CMS chưa!
      const onlineCheck = await this._verifyMachineOnline(machineId);
      if (onlineCheck.active) {
        return {
          active: true,
          key: onlineCheck.key,
          expiresAt: onlineCheck.expiresAt,
          durationType: onlineCheck.durationType,
          machineId,
        };
      }

      return { active: false, error: 'Chưa kích hoạt bản quyền thiết bị này!', machineId };
    }

    const now = new Date();

    // 1. Kiểm tra hạn dùng cứng lưu ở local
    if (local.expiresAt && new Date(local.expiresAt) < now) {
      return { active: false, error: 'Bản quyền đã hết hạn sử dụng!', machineId, key: local.licenseKey };
    }

    // 2. Offline Cache: Nếu mới verify online dưới 24h, cho phép khởi động app lập tức
    const lastChecked = new Date(local.lastCheckedAt || 0);
    const msSinceLastCheck = now.getTime() - lastChecked.getTime();
    const isCacheValid = msSinceLastCheck < 24 * 60 * 60 * 1000; // 24 giờ

    if (isCacheValid && local.cachedActive) {
      // Chạy nền tác vụ kiểm tra bản quyền ngầm với Cloudflare Worker để cập nhật trạng thái mới nhất
      this._verifyBackground(local.licenseKey, machineId).catch(() => {});

      return {
        active: true,
        key: local.licenseKey,
        expiresAt: local.expiresAt,
        durationType: local.durationType,
        machineId,
      };
    }

    // 3. Quá hạn Cache -> Phải verify online ngay lập tức
    const onlineResult = await this._verifyOnline(local.licenseKey, machineId);
    return {
      active: onlineResult.active,
      key: local.licenseKey,
      expiresAt: onlineResult.expiresAt || local.expiresAt,
      durationType: onlineResult.durationType || local.durationType,
      machineId,
      error: onlineResult.error,
    };
  }

  // Xác thực Online trực tiếp tới Cloudflare Worker
  async _verifyOnline(licenseKey, machineId) {
    const serverUrl = this._getServerUrl();
    try {
      const response = await fetch(`${serverUrl}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey, machine_id: machineId }),
        signal: AbortSignal.timeout(5000), // timeout 5 giây
      });

      const resData = await response.json();

      if (response.ok && resData.active) {
        // Cập nhật lại cache thành công
        const updatedInfo = {
          licenseKey,
          machineId,
          durationType: resData.durationType,
          expiresAt: resData.expiresAt,
          activatedAt: this._readLocal()?.activatedAt || new Date().toISOString(),
          lastCheckedAt: new Date().toISOString(),
          cachedActive: true,
        };
        this._writeLocal(updatedInfo);
        return { active: true, durationType: resData.durationType, expiresAt: resData.expiresAt };
      } else {
        // Bản quyền không hợp lệ hoặc hết hạn -> xóa cache
        this._writeLocal({});
        return { active: false, error: resData.error || 'Bản quyền không hợp lệ!' };
      }
    } catch (err) {
      // Nếu mất mạng khi hết hạn cache, tạm thời cho phép chạy offline (nếu chưa quá hạn dùng cứng)
      const local = this._readLocal();
      if (local && local.expiresAt && new Date(local.expiresAt) > new Date()) {
        return { active: true, durationType: local.durationType, expiresAt: local.expiresAt };
      }
      return { active: false, error: `Lỗi kết nối kiểm tra bản quyền: ${err.message}` };
    }
  }

  // Tác vụ xác thực ngầm để làm mới thời gian cache
  async _verifyBackground(licenseKey, machineId) {
    const serverUrl = this._getServerUrl();
    try {
      const response = await fetch(`${serverUrl}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ license_key: licenseKey, machine_id: machineId }),
        signal: AbortSignal.timeout(5000),
      });

      const resData = await response.json();
      const local = this._readLocal();

      if (response.ok && resData.active && local) {
        local.lastCheckedAt = new Date().toISOString();
        local.expiresAt = resData.expiresAt;
        this._writeLocal(local);
      } else if (response.ok && !resData.active) {
        // Server báo khóa đã bị hủy -> Xóa cache, app tự khóa ở lần chạy sau
        this._writeLocal({});
      }
    } catch (_) {
      // Lỗi mạng chạy ngầm -> bỏ qua để giữ cache
    }
  }

  // Xác thực trực tiếp bằng Machine ID (Trường hợp CMS kích hoạt trực tiếp từ xa)
  async _verifyMachineOnline(machineId) {
    const serverUrl = this._getServerUrl();
    try {
      const response = await fetch(`${serverUrl}/api/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine_id: machineId }),
        signal: AbortSignal.timeout(5000), // 5 giây timeout
      });

      const resData = await response.json();

      if (response.ok && resData.active && resData.licenseKey) {
        // Tự động lưu cache cục bộ!
        const licenseInfo = {
          licenseKey: resData.licenseKey,
          machineId,
          durationType: resData.durationType,
          expiresAt: resData.expiresAt,
          activatedAt: new Date().toISOString(),
          lastCheckedAt: new Date().toISOString(),
          cachedActive: true,
        };
        this._writeLocal(licenseInfo);
        this._cache = licenseInfo;

        return {
          active: true,
          key: resData.licenseKey,
          expiresAt: resData.expiresAt,
          durationType: resData.durationType,
        };
      }
    } catch (_) {}
    return { active: false };
  }
}

const licenseManager = new LicenseManager();
module.exports = { licenseManager };
