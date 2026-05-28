'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

/**
 * BrowserManager — Quản lý trình duyệt Playwright Chromium tích hợp.
 *
 * - Persistent profile: lưu login session giữa các lần khởi động
 * - Extension tự load từ thư mục extension/
 * - Anti-detection: không inject navigator.webdriver, user agent thật
 * - Tự động mở Google Flow sau khi login
 */
class BrowserManager {
  constructor(callbacks = {}) {
    // Đảm bảo thiết lập biến môi trường PLAYWRIGHT_BROWSERS_PATH NGAY LẬP TỨC để Playwright
    // nhận diện đúng thư mục lưu trữ trình duyệt trước khi bất kỳ lệnh require('playwright') nào chạy.
    const userDataPath = app.getPath('userData');
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(userDataPath, 'playwright-browsers');

    this._browser = null;
    this._context = null;
    this._page = null;
    this._status = { open: false, url: null, loggedIn: false };

    this._onLog = callbacks.onLog || (() => {});
    this._onStatusChange = callbacks.onStatusChange || (() => {});

    this._extensionPath = null;
    this._profileDir = null;
    this._playwright = null;
  }

  // ─── Khởi tạo đường dẫn ──────────────────────────────────
  _init() {
    // Profile directory (lưu cookies, session)
    const userDataPath = app.getPath('userData');
    this._profileDir = path.join(userDataPath, 'browser-profile');
    if (!fs.existsSync(this._profileDir)) {
      fs.mkdirSync(this._profileDir, { recursive: true });
    }

    // Extension path
    this._extensionPath = app.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'extension')
      : path.join(__dirname, '..', 'extension');
  }

  // ─── Đảm bảo Chromium đã được cài ──────────────────────
  async _ensureChromium() {
    const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const { chromium } = require('playwright');

    // Kiểm tra xem Chromium đã tồn tại chưa
    let execPath;
    try {
      execPath = chromium.executablePath();
      if (fs.existsSync(execPath)) {
        this._log(`[Browser] Chromium tìm thấy: ${execPath}`);
        return true;
      }
    } catch (_) {}

    // Chromium chưa có — tải xuống tự động
    this._log('[Browser] Chromium chưa được cài đặt. Đang tải xuống (~150MB)...');
    this._onStatusChange({ ...this._status, downloading: true });

    try {
      const { execSync } = require('child_process');
      const playwrightDir = path.dirname(require.resolve('playwright'));
      let cliPath = path.join(playwrightDir, 'cli.js');
      if (cliPath.includes('app.asar')) {
        cliPath = cliPath.replace('app.asar', 'app.asar.unpacked');
      }

      this._log(`[Browser] Đang tải Chromium qua Playwright CLI nội bộ: ${cliPath}`);
      execSync(`"${process.execPath}" "${cliPath}" install chromium`, {
        env: {
          ...process.env,
          PLAYWRIGHT_BROWSERS_PATH: browsersPath,
          ELECTRON_RUN_AS_NODE: '1'
        },
        timeout: 180_000, // 3 phút
        stdio: 'pipe',
      });
      this._log('[Browser] Đã tải Chromium xong!');
      return true;
    } catch (e) {
      this._log(`[Browser] Lỗi tải Chromium qua CLI nội bộ: ${e.message}. Thử bằng npx...`);
      // Fallback: thử npx playwright install chromium
      try {
        const { execSync } = require('child_process');
        const npxPath = process.platform === 'win32' ? 'npx.cmd' : 'npx';
        execSync(`${npxPath} playwright install chromium`, {
          env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath },
          timeout: 300_000, // 5 phút
          stdio: 'pipe',
        });
        this._log('[Browser] Đã tải Chromium xong!');
        return true;
      } catch (e2) {
        this._log(`[Browser] Lỗi tải Chromium qua npx: ${e2.message}`);
        return false;
      }
    }
  }

  async open(url = 'https://labs.google/fx/tools/flow') {
    this._init();

    // Nếu đã mở rồi, focus lại
    if (this._context && this._page) {
      try {
        await this._page.bringToFront();
        if (this._page.url() !== url) {
          await this._page.goto(url);
        }
        this._setStatus({ open: true, url: this._page.url(), loggedIn: this._status.loggedIn });
        return;
      } catch {
        // Context đã đóng, tạo mới
        await this._cleanup();
      }
    }

    this._log('[Browser] Đang khởi động trình duyệt Chromium...');

    try {
      // Đảm bảo Chromium đã được cài đặt (tải xuống nếu cần)
      const chromiumReady = await this._ensureChromium();
      if (!chromiumReady) {
        throw new Error('Không thể cài đặt Chromium. Kiểm tra kết nối internet và thử lại.');
      }

      // Lazy load playwright
      if (!this._playwright) {
        const { chromium } = require('playwright');
        this._playwright = chromium;
      }

      // Kiểm tra extension có tồn tại không
      const hasExtension = fs.existsSync(this._extensionPath);
      if (!hasExtension) {
        this._log(`[Browser] Cảnh báo: Không tìm thấy extension tại ${this._extensionPath}`);
      }

      // Args chống bot detection
      const args = [
        // Tắt automation flags
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-infobars',
        // Tắt một số Chrome security flags gây lỗi với local apps
        '--allow-running-insecure-content',
        // Performance
        '--disable-gpu-sandbox',
        // Chỉ bỏ qua proxy cho local address để đảm bảo kết nối extension-agent (127.0.0.1) không bị lỗi, nhưng vẫn dùng được VPN để tải Google Flow
        '--proxy-bypass-list=127.0.0.1,localhost,::1,<local>',
      ];

      // Load extension nếu có
      if (hasExtension) {
        args.push(`--disable-extensions-except=${this._extensionPath}`);
        args.push(`--load-extension=${this._extensionPath}`);
        this._log(`[Browser] Đã load extension từ: ${this._extensionPath}`);
      }

      // Launch persistent context (giữ session login)
      this._context = await this._playwright.launchPersistentContext(
        this._profileDir,
        {
          headless: false,
          args,
          // User agent của Chrome thật (không có Playwright/HeadlessChrome)
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          viewport: null, // Dùng kích thước cửa sổ thật
          ignoreDefaultArgs: [
            '--enable-automation',  // Quan trọng: tắt automation flag
            '--enable-blink-features=IdleDetection',
          ],
          // Kích thước cửa sổ ban đầu
          // chromiumSandbox: true,
          slowMo: 0,
          channel: undefined, // dùng playwright chromium
          locale: 'vi-VN',
          timezoneId: 'Asia/Ho_Chi_Minh',
        }
      );

      this._log('[Browser] Trình duyệt đã khởi động');

      // Lấy page đầu tiên hoặc tạo mới
      const pages = this._context.pages();
      this._page = pages.length > 0 ? pages[0] : await this._context.newPage();

      // Inject script chống detection (chạy trước mọi script của trang)
      await this._context.addInitScript(() => {
        // Xóa dấu hiệu webdriver
        Object.defineProperty(navigator, 'webdriver', {
          get: () => undefined,
          configurable: true,
        });

        // Giả lập plugins (Chrome thật có plugins, headless thì không)
        Object.defineProperty(navigator, 'plugins', {
          get: () => [1, 2, 3, 4, 5],
          configurable: true,
        });

        // Giả lập ngôn ngữ
        Object.defineProperty(navigator, 'languages', {
          get: () => ['vi-VN', 'vi', 'en-US', 'en'],
          configurable: true,
        });
      });

      // Mở URL Google Flow
      this._log(`[Browser] Đang mở: ${url}`);
      await this._page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      this._setStatus({ open: true, url: this._page.url(), loggedIn: false });

      // Theo dõi thay đổi URL (để detect login)
      this._page.on('framenavigated', (frame) => {
        if (frame === this._page.mainFrame()) {
          const currentUrl = this._page.url();
          const loggedIn = !currentUrl.includes('accounts.google.com');
          this._setStatus({ open: true, url: currentUrl, loggedIn });
        }
      });

      // Theo dõi khi đóng
      this._context.on('close', () => {
        this._log('[Browser] Trình duyệt đã đóng');
        this._cleanup();
        this._setStatus({ open: false, url: null, loggedIn: false });
      });

      this._page.on('close', async () => {
        // Nếu đóng page cuối, tạo page mới
        await new Promise(r => setTimeout(r, 100));
        const remainingPages = this._context?.pages() || [];
        if (remainingPages.length === 0 && this._context) {
          this._log('[Browser] Tất cả tabs đã đóng, đóng trình duyệt');
          await this._cleanup();
          this._setStatus({ open: false, url: null, loggedIn: false });
        }
      });

      this._log('[Browser] Đã mở Google Flow thành công');

    } catch (err) {
      this._log(`[Browser] Lỗi khởi động: ${err.message}`);
      await this._cleanup();
      throw err;
    }
  }

  // ─── Đóng trình duyệt ────────────────────────────────────
  async close() {
    this._log('[Browser] Đang đóng trình duyệt...');
    await this._cleanup();
    this._setStatus({ open: false, url: null, loggedIn: false });
  }

  // ─── Xóa session (đăng xuất) ─────────────────────────────
  async clearSession() {
    this._log('[Browser] Đang xóa session đăng nhập...');
    await this._cleanup();

    // Xóa profile directory
    if (this._profileDir && fs.existsSync(this._profileDir)) {
      fs.rmSync(this._profileDir, { recursive: true, force: true });
      this._log('[Browser] Đã xóa dữ liệu session');
    }

    this._setStatus({ open: false, url: null, loggedIn: false });
  }

  // ─── Cleanup nội bộ ──────────────────────────────────────
  async _cleanup() {
    try {
      if (this._context) {
        await this._context.close().catch(() => {});
      }
    } catch (_) {}
    this._context = null;
    this._page = null;
  }

  // ─── Getters ─────────────────────────────────────────────
  getStatus() {
    return { ...this._status };
  }

  // ─── Helpers ─────────────────────────────────────────────
  _log(msg) {
    try { process.stdout.write(msg + '\n'); } catch (_) {}
    this._onLog(msg);
  }

  _setStatus(status) {
    this._status = status;
    this._onStatusChange(status);
  }
}

module.exports = { BrowserManager };
