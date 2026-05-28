// Cloudflare Worker: Flowkit License Management Server & Visual Admin Dashboard
// Triển khai bằng TypeScript, kết nối với cơ sở dữ liệu Cloudflare D1 SQL.

export interface Env {
  DB: D1Database;
  ADMIN_SECRET: string;
  ADMIN_USER?: string;
  ADMIN_PASS?: string;
}


interface LicenseRow {
  id: string;
  license_key: string;
  machine_id: string | null;
  status: 'INACTIVE' | 'ACTIVE' | 'EXPIRED';
  duration_type: 'TRIAL' | '1_MONTH' | '6_MONTHS' | '1_YEAR';
  created_at: string;
  activated_at: string | null;
  expires_at: string | null;
}

// Helper sinh HTTP Response có CORS headers
function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

// Xử lý các request OPTIONS (CORS Preflight)
function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    },
  });
}

// Helper chuẩn hóa Key để tránh nhầm lẫn giữa chữ O và số 0, chữ I/L và số 1, loại bỏ gạch ngang
function normalizeKey(key: string): string {
  return key.trim().toUpperCase()
    .replace(/[^A-Z0-9]/g, '') // Loại bỏ dấu gạch ngang và ký tự đặc biệt
    .replace(/[0O]/g, '0')     // Đồng bộ 0 và O thành 0
    .replace(/[1IL]/g, '1');    // Đồng bộ 1, I, L thành 1
}

// Trình sinh License Key ngẫu nhiên không có ký tự mơ hồ (Loại bỏ O, 0, I, 1, L)
function generateLicenseKey(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Loại bỏ O, 0, I, 1
  const segment = () => Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `FK-${segment()}-${segment()}-${segment()}-${segment()}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Xử lý CORS preflight
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    try {
      // ─── 0. GIAO DIỆN ADMIN DASHBOARD TRANG CHỦ (GET /) ───
      if (url.pathname === '/' && request.method === 'GET') {
        return new Response(getAdminHtml(env.ADMIN_SECRET), {
          headers: {
            'Content-Type': 'text/html; charset=utf-8',
            'Access-Control-Allow-Origin': '*',
          },
        });
      }

      // ─── 1. API Kích hoạt Bản quyền (POST /api/activate) ───
      if (url.pathname === '/api/activate' && request.method === 'POST') {
        const { license_key, machine_id } = await request.json() as { license_key?: string, machine_id?: string };
        if (!license_key || !machine_id) {
          return jsonResponse({ error: 'Thiếu thông tin license_key hoặc machine_id!' }, 400);
        }

        const cleanKey = normalizeKey(license_key);
        const cleanMachineId = machine_id.trim();

        const licenses = await env.DB.prepare('SELECT * FROM licenses').all<LicenseRow>();
        const license = licenses.results.find(l => normalizeKey(l.license_key) === cleanKey);

        if (!license) {
          return jsonResponse({ error: 'Mã kích hoạt này không tồn tại trên hệ thống!' }, 404);
        }

        const now = new Date();

        if (license.machine_id && license.machine_id !== cleanMachineId) {
          return jsonResponse({ error: 'Mã kích hoạt này đã được sử dụng trên một thiết bị khác!' }, 400);
        }

        if (license.status === 'ACTIVE' && license.machine_id === cleanMachineId) {
          if (license.expires_at && new Date(license.expires_at) < now) {
            await env.DB.prepare("UPDATE licenses SET status = 'EXPIRED' WHERE id = ?").bind(license.id).run();
            return jsonResponse({ error: 'Bản quyền của bạn đã hết hạn sử dụng!' }, 400);
          }
          return jsonResponse({
            success: true,
            message: 'Phục hồi kích hoạt bản quyền thành công!',
            durationType: license.duration_type,
            expiresAt: license.expires_at,
          });
        }

        if (license.status === 'EXPIRED' || (license.expires_at && new Date(license.expires_at) < now)) {
          if (license.status !== 'EXPIRED') {
            await env.DB.prepare("UPDATE licenses SET status = 'EXPIRED' WHERE id = ?").bind(license.id).run();
          }
          return jsonResponse({ error: 'Bản quyền của bạn đã hết hạn sử dụng!' }, 400);
        }

        // Kích hoạt mới (INACTIVE -> ACTIVE)
        let daysToAdd = 3; // TRIAL
        if (license.duration_type === '1_MONTH') daysToAdd = 30;
        else if (license.duration_type === '6_MONTHS') daysToAdd = 180;
        else if (license.duration_type === '1_YEAR') daysToAdd = 365;

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + daysToAdd);
        const expiresAtStr = expiresAt.toISOString().replace('T', ' ').substring(0, 19);
        const activatedAtStr = now.toISOString().replace('T', ' ').substring(0, 19);

        await env.DB.prepare(
          "UPDATE licenses SET status = 'ACTIVE', machine_id = ?, activated_at = ?, expires_at = ? WHERE id = ?"
        ).bind(cleanMachineId, activatedAtStr, expiresAtStr, license.id).run();

        return jsonResponse({
          success: true,
          message: 'Kích hoạt bản quyền thành công!',
          durationType: license.duration_type,
          expiresAt: expiresAtStr,
        });
      }

      // ─── 2. API Xác thực Bản quyền (POST /api/verify) ───
      if (url.pathname === '/api/verify' && request.method === 'POST') {
        const { license_key, machine_id } = await request.json() as { license_key?: string, machine_id?: string };
        if (!machine_id) {
          return jsonResponse({ active: false, error: 'Thiếu thông tin mã máy!' }, 400);
        }

        const cleanMachineId = machine_id.trim();
        let license: LicenseRow | null = null;

        if (license_key) {
          const cleanKey = normalizeKey(license_key);
          const licenses = await env.DB.prepare('SELECT * FROM licenses').all<LicenseRow>();
          license = licenses.results.find(l => normalizeKey(l.license_key) === cleanKey) || null;
        } else {
          // Kích hoạt trực tiếp bằng Machine ID: Tìm key ACTIVE được liên kết với máy này
          license = await env.DB.prepare(
            "SELECT * FROM licenses WHERE machine_id = ? AND status = 'ACTIVE'"
          ).bind(cleanMachineId).first<LicenseRow>();
        }

        if (!license || license.machine_id !== cleanMachineId) {
          return jsonResponse({ active: false, error: 'Bản quyền hoặc thiết bị kích hoạt không hợp lệ!' });
        }

        const now = new Date();

        if (license.expires_at && new Date(license.expires_at) < now) {
          if (license.status !== 'EXPIRED') {
            await env.DB.prepare("UPDATE licenses SET status = 'EXPIRED' WHERE id = ?").bind(license.id).run();
          }
          return jsonResponse({ active: false, error: 'Bản quyền đã hết hạn sử dụng!' });
        }

        if (license.status !== 'ACTIVE') {
          return jsonResponse({ active: false, error: 'Bản quyền chưa được kích hoạt hoặc không hoạt động!' });
        }

        return jsonResponse({
          active: true,
          licenseKey: license.license_key,
          durationType: license.duration_type,
          expiresAt: license.expires_at,
        });
      }

      // ─── 2.5 API Đăng nhập Admin (POST /api/admin/login) ───
      if (url.pathname === '/api/admin/login' && request.method === 'POST') {
        const { username, password } = await request.json() as { username?: string, password?: string };
        const adminUser = env.ADMIN_USER || 'soianchay';
        const adminPass = env.ADMIN_PASS || 'Truong@30031993';

        if (username === adminUser && password === adminPass) {
          return jsonResponse({
            success: true,
            token: env.ADMIN_SECRET
          });
        }

        return jsonResponse({ error: 'Tên đăng nhập hoặc mật khẩu quản trị không chính xác!' }, 401);
      }

      // ─── 3. API Sinh Khóa cho Admin (POST /api/admin/generate-key) ───
      if (url.pathname === '/api/admin/generate-key' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
          return jsonResponse({ error: 'Không có quyền truy cập!' }, 401);
        }

        const { duration_type, count } = await request.json() as { duration_type?: string, count?: number };
        const allowedTypes = ['TRIAL', '1_MONTH', '6_MONTHS', '1_YEAR'];
        if (!duration_type || !allowedTypes.includes(duration_type)) {
          return jsonResponse({ error: `duration_type không hợp lệ! Cho phép: ${allowedTypes.join(', ')}` }, 400);
        }

        const numKeys = count && count > 0 && count <= 100 ? count : 1;
        const generatedKeys = [];

        const statements = [];
        for (let i = 0; i < numKeys; i++) {
          const id = crypto.randomUUID();
          const key = generateLicenseKey();
          generatedKeys.push(key);

          statements.push(
            env.DB.prepare(
              "INSERT INTO licenses (id, license_key, duration_type, status) VALUES (?, ?, ?, 'INACTIVE')"
            ).bind(id, key, duration_type)
          );
        }

        await env.DB.batch(statements);

        return jsonResponse({
          success: true,
          message: `Đã sinh thành công ${numKeys} khóa bản quyền loại ${duration_type}!`,
          keys: generatedKeys,
        });
      }

      // ─── 4. API Lấy danh sách khóa cho Admin (POST /api/admin/list-keys) ───
      if (url.pathname === '/api/admin/list-keys' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
          return jsonResponse({ error: 'Không có quyền truy cập!' }, 401);
        }

        const licenses = await env.DB.prepare(
          'SELECT * FROM licenses ORDER BY created_at DESC'
        ).all<LicenseRow>();

        return jsonResponse({ success: true, licenses: licenses.results });
      }

      // ─── 5. API Reset Mã máy của Khóa (POST /api/admin/reset-machine) ───
      if (url.pathname === '/api/admin/reset-machine' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
          return jsonResponse({ error: 'Không có quyền truy cập!' }, 401);
        }

        const { id } = await request.json() as { id?: string };
        if (!id) return jsonResponse({ error: 'Thiếu thông tin id!' }, 400);

        await env.DB.prepare(
          "UPDATE licenses SET status = 'INACTIVE', machine_id = NULL, activated_at = NULL, expires_at = NULL WHERE id = ?"
        ).bind(id).run();

        return jsonResponse({ success: true, message: 'Đã giải phóng liên kết mã máy của khóa thành công!' });
      }

      // ─── 6. API Xóa Khóa (POST /api/admin/delete-key) ───
      if (url.pathname === '/api/admin/delete-key' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
          return jsonResponse({ error: 'Không có quyền truy cập!' }, 401);
        }

        const { id } = await request.json() as { id?: string };
        if (!id) return jsonResponse({ error: 'Thiếu thông tin id!' }, 400);

        await env.DB.prepare('DELETE FROM licenses WHERE id = ?').bind(id).run();

        return jsonResponse({ success: true, message: 'Đã xóa khóa bản quyền khỏi hệ thống!' });
      }

      // ─── 7. API Kích hoạt trực tiếp bằng Machine ID (POST /api/admin/activate-machine) ───
      if (url.pathname === '/api/admin/activate-machine' && request.method === 'POST') {
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.ADMIN_SECRET}`) {
          return jsonResponse({ error: 'Không có quyền truy cập!' }, 401);
        }

        const { machine_id, duration_type } = await request.json() as { machine_id?: string, duration_type?: string };
        const allowedTypes = ['TRIAL', '1_MONTH', '6_MONTHS', '1_YEAR'];
        if (!machine_id || !duration_type || !allowedTypes.includes(duration_type)) {
          return jsonResponse({ error: 'Thiếu hoặc sai thông tin machine_id / duration_type!' }, 400);
        }

        const cleanMachineId = machine_id.trim();

        // Kiểm tra xem máy này đã có key nào đang ACTIVE chưa
        const existing = await env.DB.prepare(
          "SELECT * FROM licenses WHERE machine_id = ? AND status = 'ACTIVE'"
        ).bind(cleanMachineId).first<LicenseRow>();

        if (existing) {
          return jsonResponse({ 
            error: `Thiết bị này đã được kích hoạt trước đó với Key: ${existing.license_key}` 
          }, 400);
        }

        const id = crypto.randomUUID();
        const key = generateLicenseKey();
        const now = new Date();

        let daysToAdd = 3; // TRIAL
        if (duration_type === '1_MONTH') daysToAdd = 30;
        else if (duration_type === '6_MONTHS') daysToAdd = 180;
        else if (duration_type === '1_YEAR') daysToAdd = 365;

        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + daysToAdd);
        const expiresAtStr = expiresAt.toISOString().replace('T', ' ').substring(0, 19);
        const activatedAtStr = now.toISOString().replace('T', ' ').substring(0, 19);

        await env.DB.prepare(
          "INSERT INTO licenses (id, license_key, machine_id, status, duration_type, activated_at, expires_at) VALUES (?, ?, ?, 'ACTIVE', ?, ?, ?)"
        ).bind(id, key, cleanMachineId, duration_type, activatedAtStr, expiresAtStr).run();

        return jsonResponse({
          success: true,
          message: 'Kích hoạt thiết bị thành công!',
          license_key: key,
          expires_at: expiresAtStr,
        });
      }

      // 404 cho các route không khớp
      return jsonResponse({
        error: 'API endpoint không tồn tại!',
        requestedPath: url.pathname,
        requestedMethod: request.method
      }, 404);

    } catch (e: any) {
      return jsonResponse({ error: `Lỗi hệ thống máy chủ Cloudflare Worker: ${e.message}` }, 500);
    }
  },
};

// ─── GIAO DIỆN QUẢN TRỊ HTML / CSS / JS ĐỒNG BỘ NATIVE ───────────────────
function getAdminHtml(adminSecretPlaceholder: string): string {
  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flowkit — License Admin Console</title>
  <!-- Tailwind CSS & Google Font -->
  <script src="https://cdn.tailwindcss.com"></script>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <!-- Lucide Icons via CDN -->
  <script src="https://unpkg.com/lucide@latest"></script>
  <style>
    body {
      font-family: 'Outfit', sans-serif;
      background: #08090d;
      background-image: radial-gradient(circle at 50% 0%, rgba(124, 91, 245, 0.08) 0%, transparent 50%);
    }
    .glass-panel {
      background: rgba(20, 24, 36, 0.7);
      backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.06);
    }
  </style>
</head>
<body class="text-slate-200 min-h-screen pb-12">

  <!-- Main Container -->
  <div class="max-w-6xl mx-auto px-4 pt-8">
    
    <!-- Header -->
    <header class="flex items-center justify-between mb-8 pb-6 border-b border-white/5">
      <div class="flex items-center gap-3">
        <div class="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#7c5bf5] to-[#6248d8] flex items-center justify-center shadow-lg shadow-[#7c5bf5]/20">
          <i data-lucide="sparkles" class="w-5 h-5 text-white"></i>
        </div>
        <div>
          <h1 class="text-xl font-bold tracking-tight text-white">Flowkit <span class="text-xs font-medium text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded-full ml-1.5 border border-purple-500/20">Admin</span></h1>
          <p class="text-xs text-slate-400">by AWEMEDIA — Hệ thống quản lý bản quyền</p>
        </div>
      </div>
      <!-- Nút logout -->
      <button id="logoutBtn" class="hidden text-xs text-slate-400 hover:text-red-400 border border-white/5 hover:border-red-500/20 bg-white/5 hover:bg-red-500/10 px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5">
        <i data-lucide="log-out" class="w-3.5 h-3.5"></i> Đăng xuất
      </button>
    </header>

    <!-- ─── PHÂN HỆ ĐĂNG NHẬP (AUTH SCREEN) ─── -->
    <div id="authScreen" class="max-w-md mx-auto my-20">
      <div class="glass-panel rounded-2xl p-8 shadow-2xl">
        <div class="text-center mb-6">
          <div class="inline-flex w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 items-center justify-center text-purple-400 mb-3">
            <i data-lucide="lock" class="w-6 h-6"></i>
          </div>
          <h2 class="text-lg font-bold text-white">Xác thực quyền Quản trị viên</h2>
          <p class="text-xs text-slate-400 mt-1">Nhập tài khoản quản trị để quản lý bản quyền</p>
        </div>
        <form id="authForm" class="space-y-4">
          <div>
            <label class="text-xs text-slate-400 block mb-1 font-medium">Tên đăng nhập</label>
            <input type="text" id="usernameInput" placeholder="Nhập tên đăng nhập..." class="w-full bg-slate-950/80 border border-white/5 focus:border-[#7c5bf5] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition-all">
          </div>
          <div>
            <label class="text-xs text-slate-400 block mb-1 font-medium">Mật khẩu</label>
            <input type="password" id="passwordInput" placeholder="Nhập mật khẩu..." class="w-full bg-slate-950/80 border border-white/5 focus:border-[#7c5bf5] rounded-xl px-4 py-2.5 text-sm text-white outline-none transition-all">
          </div>
          <div id="loginError" class="text-xs text-red-400 text-center hidden font-medium"></div>
          <button type="submit" class="w-full bg-gradient-to-r from-[#7c5bf5] to-[#6248d8] text-sm text-white font-bold py-3 rounded-xl hover:opacity-90 active:scale-[0.99] transition-all">
            Đăng nhập hệ thống
          </button>
        </form>
      </div>
    </div>

    <!-- ─── PHÂN HỆ DASHBOARD CHÍNH ─── -->
    <div id="mainDashboard" class="hidden space-y-8">
      
      <!-- Analytics Grid -->
      <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div class="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wider font-bold">Tổng số khóa</div>
            <div id="statTotal" class="text-3xl font-bold text-white mt-1">0</div>
          </div>
          <div class="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center"><i data-lucide="key-round"></i></div>
        </div>
        <div class="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wider font-bold">Đang hoạt động</div>
            <div id="statActive" class="text-3xl font-bold text-green-400 mt-1">0</div>
          </div>
          <div class="w-12 h-12 rounded-xl bg-green-500/10 text-green-400 flex items-center justify-center"><i data-lucide="shield-check"></i></div>
        </div>
        <div class="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wider font-bold">Chưa kích hoạt</div>
            <div id="statInactive" class="text-3xl font-bold text-slate-400 mt-1">0</div>
          </div>
          <div class="w-12 h-12 rounded-xl bg-slate-500/10 text-slate-400 flex items-center justify-center"><i data-lucide="pause-circle"></i></div>
        </div>
        <div class="glass-panel rounded-2xl p-5 flex items-center justify-between">
          <div>
            <div class="text-xs text-slate-400 uppercase tracking-wider font-bold">Đã quá hạn</div>
            <div id="statExpired" class="text-3xl font-bold text-red-400 mt-1">0</div>
          </div>
          <div class="w-12 h-12 rounded-xl bg-red-500/10 text-red-400 flex items-center justify-center"><i data-lucide="shield-alert"></i></div>
        </div>
      </div>

      <!-- Action Panel & Key Generator -->
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        <!-- Generator Console -->
        <div class="glass-panel rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 class="text-base font-bold text-white mb-4 flex items-center gap-2">
              <i data-lucide="plus-circle" class="w-4.5 h-4.5 text-purple-400"></i> Sinh khóa bản quyền mới
            </h2>
            <form id="genForm" class="space-y-4">
              <div>
                <label class="text-xs text-slate-400 block mb-1">Thời hạn (Package)</label>
                <select id="genDuration" class="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-xs outline-none focus:border-purple-500 text-slate-200">
                  <option value="TRIAL">TRIAL (3 ngày)</option>
                  <option value="1_MONTH">1 Tháng (30 ngày)</option>
                  <option value="6_MONTHS">6 Tháng (180 ngày)</option>
                  <option value="1_YEAR">1 Năm (365 ngày)</option>
                </select>
              </div>
              <div>
                <label class="text-xs text-slate-400 block mb-1">Số lượng cần sinh (1 - 100)</label>
                <input type="number" id="genCount" min="1" max="100" value="1" class="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-xs outline-none focus:border-purple-500 text-white">
              </div>
              <button type="submit" class="w-full bg-gradient-to-r from-purple-500 to-indigo-600 hover:opacity-90 font-bold py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2">
                <i data-lucide="zap" class="w-4 h-4"></i> Tạo khóa kích hoạt
              </button>
            </form>
          </div>
        </div>

        <!-- Direct Activation Console -->
        <div class="glass-panel rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h2 class="text-base font-bold text-white mb-4 flex items-center gap-2">
              <i data-lucide="cpu" class="w-4.5 h-4.5 text-indigo-400"></i> Kích hoạt Machine ID
            </h2>
            <form id="directForm" class="space-y-4">
              <div>
                <label class="text-xs text-slate-400 block mb-1">Mã thiết bị (Machine ID)</label>
                <input type="text" id="directMachineId" placeholder="Nhập mã định danh SHA-256..." required class="w-full bg-slate-950 border border-white/5 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs text-white outline-none transition-all font-mono">
              </div>
              <div>
                <label class="text-xs text-slate-400 block mb-1">Thời hạn (Package)</label>
                <select id="directDuration" class="w-full bg-slate-950 border border-white/5 rounded-xl px-3 py-2 text-xs outline-none focus:border-indigo-500 text-slate-200">
                  <option value="TRIAL">TRIAL (3 ngày)</option>
                  <option value="1_MONTH">1 Tháng (30 ngày)</option>
                  <option value="6_MONTHS">6 Tháng (180 ngày)</option>
                  <option value="1_YEAR">1 Năm (365 ngày)</option>
                </select>
              </div>
              <button type="submit" class="w-full bg-gradient-to-r from-indigo-500 to-purple-600 hover:opacity-90 font-bold py-2.5 rounded-xl text-xs transition-all flex items-center justify-center gap-2">
                <i data-lucide="shield-check" class="w-4 h-4"></i> Kích hoạt thiết bị
              </button>
            </form>
          </div>
        </div>

        <!-- Action Result Panel -->
        <div class="glass-panel rounded-2xl p-6 flex flex-col justify-between min-h-[220px]">
          <div>
            <h2 class="text-base font-bold text-white mb-3 flex items-center gap-2">
              <i data-lucide="check-square" class="w-4.5 h-4.5 text-green-400"></i> Trạng thái / Kết quả tạo
            </h2>
            <p class="text-xs text-slate-400 mb-3">Thông tin chi tiết của hành động vừa thực hiện gần nhất.</p>
            <div id="newKeysContainer" class="bg-slate-950/80 border border-white/5 rounded-xl p-3 max-h-[140px] overflow-y-auto font-mono text-xs text-purple-400 space-y-1.5 select-all">
              <div class="text-slate-500 italic text-center py-6">Chưa có hoạt động nào được thực hiện gần đây.</div>
            </div>
          </div>
        </div>

      </div>

      <!-- Main Database Licenses Table -->
      <div class="glass-panel rounded-2xl overflow-hidden shadow-2xl">
        
        <!-- Table Header & Search -->
        <div class="p-6 border-b border-white/5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/[0.01]">
          <div>
            <h2 class="text-lg font-bold text-white">Danh sách Khóa kích hoạt</h2>
            <p class="text-xs text-slate-400 mt-0.5">Quản lý, tìm kiếm, hủy kích hoạt thiết bị, giải phóng máy.</p>
          </div>
          <div class="relative w-full sm:w-72">
            <input type="text" id="searchInput" placeholder="Tìm kiếm theo khóa, mã máy..." class="w-full bg-slate-950 border border-white/5 focus:border-[#7c5bf5] rounded-xl pl-9 pr-4 py-2 text-xs text-white outline-none transition-all">
            <i data-lucide="search" class="w-3.5 h-3.5 text-slate-500 absolute left-3 top-3"></i>
          </div>
        </div>

        <!-- Interactive Table Container -->
        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse text-xs">
            <thead>
              <tr class="border-b border-white/5 text-slate-400 font-bold uppercase tracking-wider bg-white/[0.01]">
                <th class="p-4 pl-6">Khóa Bản Quyền (License Key)</th>
                <th class="p-4">Thời Hạn</th>
                <th class="p-4">Thiết Bị Cực Bộ (Machine ID)</th>
                <th class="p-4">Trạng Thái</th>
                <th class="p-4">Ngày Hết Hạn</th>
                <th class="p-4 pr-6 text-right">Thao Tác</th>
              </tr>
            </thead>
            <tbody id="tableBody" class="divide-y divide-white/5">
              <tr>
                <td colspan="6" class="p-12 text-center text-slate-500 italic">Đang tải cơ sở dữ liệu bản quyền...</td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>

    </div>

  </div>

  <!-- JavaScript Admin Console Engine -->
  <script>
    let ADMIN_SECRET = localStorage.getItem('flowkit_admin_secret') || '';
    let allLicenses = [];

    document.addEventListener('DOMContentLoaded', () => {
      initAuth();
      setupEventListeners();
    });

    function initAuth() {
      if (ADMIN_SECRET) {
        document.getElementById('authScreen').classList.add('hidden');
        document.getElementById('mainDashboard').classList.remove('hidden');
        document.getElementById('logoutBtn').classList.remove('hidden');
        fetchLicenses();
      } else {
        document.getElementById('authScreen').classList.remove('hidden');
        document.getElementById('mainDashboard').classList.add('hidden');
        document.getElementById('logoutBtn').classList.add('hidden');
      }
      setTimeout(() => lucide.createIcons(), 50);
    }

    function setupEventListeners() {
      // Form login
      document.getElementById('authForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('usernameInput').value.trim();
        const password = document.getElementById('passwordInput').value;
        const errDiv = document.getElementById('loginError');
        const submitBtn = e.target.querySelector('button[type="submit"]');

        if (!username || !password) {
          errDiv.innerText = 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu!';
          errDiv.classList.remove('hidden');
          return;
        }

        errDiv.classList.add('hidden');
        submitBtn.disabled = true;
        submitBtn.innerText = 'Đang xác thực...';

        try {
          const res = await fetch('/api/admin/login', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({ username, password })
          });

          const data = await res.json();
          if (res.ok && data.success && data.token) {
            ADMIN_SECRET = data.token;
            localStorage.setItem('flowkit_admin_secret', data.token);
            initAuth();
          } else {
            errDiv.innerText = data.error || 'Tên đăng nhập hoặc mật khẩu không chính xác!';
            errDiv.classList.remove('hidden');
          }
        } catch (err) {
          errDiv.innerText = 'Lỗi kết nối máy chủ: ' + err.message;
          errDiv.classList.remove('hidden');
        } finally {
          submitBtn.disabled = false;
          submitBtn.innerText = 'Đăng nhập hệ thống';
        }
      });

      // Nút logout
      document.getElementById('logoutBtn').addEventListener('click', () => {
        ADMIN_SECRET = '';
        localStorage.removeItem('flowkit_admin_secret');
        initAuth();
        document.getElementById('usernameInput').value = '';
        document.getElementById('passwordInput').value = '';
        const errDiv = document.getElementById('loginError');
        if (errDiv) errDiv.classList.add('hidden');
      });

      // Form sinh khóa mới
      document.getElementById('genForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const duration = document.getElementById('genDuration').value;
        const count = parseInt(document.getElementById('genCount').value) || 1;

        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4 animate-spin"></i> Đang tạo...';
        lucide.createIcons();

        try {
          const res = await fetch('/api/admin/generate-key', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + ADMIN_SECRET
            },
            body: JSON.stringify({ duration_type: duration, count })
          });

          const data = await res.json();
          if (res.ok && data.success) {
            // Render các khóa vừa sinh
            const container = document.getElementById('newKeysContainer');
            container.innerHTML = data.keys.map(k => \`<div class="flex items-center justify-between border-b border-white/5 py-1"><span>\${k}</span><button onclick="copyText('\${k}')" class="text-[10px] text-slate-500 hover:text-purple-400 bg-white/5 border border-white/10 px-1.5 py-0.5 rounded">Copy</button></div>\`).join('');
            
            // Tải lại bảng
            fetchLicenses();
          } else {
            alert(data.error || 'Lỗi không xác định!');
          }
        } catch (err) {
          alert('Không thể kết nối API: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="zap" class="w-4 h-4"></i> Tạo khóa kích hoạt';
          lucide.createIcons();
        }
      });

      // Form kích hoạt trực tiếp Machine ID
      document.getElementById('directForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const machineId = document.getElementById('directMachineId').value.trim();
        const duration = document.getElementById('directDuration').value;

        const btn = e.target.querySelector('button[type="submit"]');
        btn.disabled = true;
        btn.innerHTML = '<i data-lucide="refresh-cw" class="w-4 h-4 animate-spin"></i> Đang kích hoạt...';
        lucide.createIcons();

        try {
          const res = await fetch('/api/admin/activate-machine', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + ADMIN_SECRET
            },
            body: JSON.stringify({ machine_id: machineId, duration_type: duration })
          });

          const data = await res.json();
          if (res.ok && data.success) {
            // Render kết quả kích hoạt trực tiếp
            const container = document.getElementById('newKeysContainer');
            container.innerHTML = \`
              <div class="text-green-400 font-bold mb-1 flex items-center gap-1"><i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Kích hoạt OK!</div>
              <div class="text-slate-300 py-1 font-mono text-[11px] select-all">\${data.license_key}</div>
              <div class="text-slate-400 text-[10px]">Hạn dùng: \${data.expires_at.substring(0, 10)}</div>
              <button onclick="copyText('\${data.license_key}')" class="mt-2 text-[10px] text-purple-400 bg-white/5 border border-white/10 px-2 py-0.5 rounded hover:bg-purple-500/10 hover:border-purple-500/20">Copy Key</button>
            \`;
            
            // Tải lại bảng
            fetchLicenses();
            document.getElementById('directMachineId').value = '';
          } else {
            alert(data.error || 'Lỗi không xác định!');
          }
        } catch (err) {
          alert('Không thể kết nối API: ' + err.message);
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<i data-lucide="shield-check" class="w-4 h-4"></i> Kích hoạt thiết bị';
          lucide.createIcons();
        }
      });

      // Search Filter
      document.getElementById('searchInput').addEventListener('input', (e) => {
        const val = e.target.value.toLowerCase().trim();
        renderTable(val);
      });
    }

    async function fetchLicenses() {
      try {
        const res = await fetch('/api/admin/list-keys', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + ADMIN_SECRET
          }
        });

        const data = await res.json();
        if (res.ok && data.success) {
          allLicenses = data.licenses || [];
          renderStats();
          renderTable();
        } else {
          // Token sai hoặc hết hạn cấu hình
          if (res.status === 401) {
            alert('Khóa bảo mật Admin không đúng! Vui lòng đăng nhập lại.');
            document.getElementById('logoutBtn').click();
          }
        }
      } catch (err) {
        console.error('Lỗi fetch:', err.message);
      }
    }

    function renderStats() {
      const total = allLicenses.length;
      const active = allLicenses.filter(l => l.status === 'ACTIVE').length;
      const inactive = allLicenses.filter(l => l.status === 'INACTIVE').length;
      const expired = allLicenses.filter(l => l.status === 'EXPIRED').length;

      document.getElementById('statTotal').innerText = total;
      document.getElementById('statActive').innerText = active;
      document.getElementById('statInactive').innerText = inactive;
      document.getElementById('statExpired').innerText = expired;
    }

    function renderTable(filter = '') {
      const body = document.getElementById('tableBody');
      const filtered = allLicenses.filter(l => {
        return l.license_key.toLowerCase().includes(filter) ||
               (l.machine_id && l.machine_id.toLowerCase().includes(filter));
      });

      if (filtered.length === 0) {
        body.innerHTML = \`<tr><td colspan="6" class="p-12 text-center text-slate-500 italic">Không tìm thấy khóa nào tương thích với bộ lọc.</td></tr>\`;
        return;
      }

      body.innerHTML = filtered.map(l => {
        // Badge Trạng thái
        let statusBadge = '';
        if (l.status === 'ACTIVE') {
          statusBadge = '<span class="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 font-semibold text-[10px]">ACTIVE</span>';
        } else if (l.status === 'EXPIRED') {
          statusBadge = '<span class="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-semibold text-[10px]">EXPIRED</span>';
        } else {
          statusBadge = '<span class="px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-400 border border-white/5 font-semibold text-[10px]">INACTIVE</span>';
        }

        // Hạn dùng hiển thị
        const expiry = l.expires_at ? l.expires_at.substring(0, 10) : '—';
        const durationLabel = l.duration_type === 'TRIAL' ? '3 ngày (TRIAL)' : 
                              l.duration_type === '1_MONTH' ? '1 Tháng' :
                              l.duration_type === '6_MONTHS' ? '6 Tháng' : '1 Năm';

        const machineDisp = l.machine_id ? 
                            \`<span class="font-mono text-purple-400 truncate max-w-[160px] inline-block" title="\${l.machine_id}">\${l.machine_id.substring(0,12)}...</span>\` 
                            : '<span class="text-slate-600">—</span>';

        return \`
          <tr class="hover:bg-white/[0.01] transition-all">
            <td class="p-4 pl-6 font-mono font-bold text-white">
              <span class="mr-2">\${l.license_key}</span>
              <button onclick="copyText('\${l.license_key}')" class="text-slate-500 hover:text-slate-300 transition-all" title="Copy Key">
                <i data-lucide="copy" class="w-3.5 h-3.5 inline"></i>
              </button>
            </td>
            <td class="p-4 font-semibold text-slate-300">\${durationLabel}</td>
            <td class="p-4">\${machineDisp}</td>
            <td class="p-4">\${statusBadge}</td>
            <td class="p-4 font-mono text-slate-400">\${expiry}</td>
            <td class="p-4 pr-6 text-right space-x-1.5">
              \${l.machine_id ? \`
                <button onclick="resetMachine('\${l.id}')" class="text-xs bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/20 text-yellow-500 px-2 py-1 rounded-lg transition-all" title="Giải phóng liên kết máy để chuyển máy khác">
                  <i data-lucide="refresh-cw" class="w-3 h-3 inline mr-1"></i> Reset máy
                </button>
              \` : ''}
              <button onclick="deleteKey('\${l.id}')" class="text-xs bg-red-500/10 hover:bg-red-500/20 border border-red-500/25 text-red-400 p-1.5 rounded-lg transition-all" title="Xóa Key vĩnh viễn">
                <i data-lucide="trash-2" class="w-3.5 h-3.5 inline"></i>
              </button>
            </td>
          </tr>
        \`;
      }).join('');

      setTimeout(() => lucide.createIcons(), 20);
    }

    async function resetMachine(id) {
      if (!confirm('Bạn có chắc chắn muốn giải phóng liên kết mã máy của khóa này không? Khách hàng sẽ có thể kích hoạt lại trên máy khác.')) return;
      try {
        const res = await fetch('/api/admin/reset-machine', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + ADMIN_SECRET
          },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          fetchLicenses();
        } else {
          alert(data.error);
        }
      } catch (err) {
        alert(err.message);
      }
    }

    async function deleteKey(id) {
      if (!confirm('CẢNH BÁO: Bạn có chắc chắn muốn XÓA VĨNH VIỄN khóa kích hoạt này không? Thao tác này không thể hoàn tác!')) return;
      try {
        const res = await fetch('/api/admin/delete-key', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + ADMIN_SECRET
          },
          body: JSON.stringify({ id })
        });
        const data = await res.json();
        if (res.ok && data.success) {
          fetchLicenses();
        } else {
          alert(data.error);
        }
      } catch (err) {
        alert(err.message);
      }
    }

    function copyText(txt) {
      navigator.clipboard.writeText(txt);
      // alert('Đã copy khóa kích hoạt vào bộ nhớ tạm!');
    }
  </script>
</body>
</html>`;
}
