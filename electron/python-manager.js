'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const { app } = require('electron');

const AGENT_HOST = '127.0.0.1';
const AGENT_PORT = 8100;
const WS_PORT = 9222;
const HEALTH_URL = `http://${AGENT_HOST}:${AGENT_PORT}/health`;
const MAX_STARTUP_WAIT_MS = 30_000;
const HEALTH_CHECK_INTERVAL_MS = 500;
const MAX_RETRIES = MAX_STARTUP_WAIT_MS / HEALTH_CHECK_INTERVAL_MS;

// ─── Safe logger (never throws EPIPE) ──────────────────────
function safeLog(msg) {
  try {
    process.stdout.write(msg + '\n');
  } catch (_) {
    // ignore EPIPE / write errors silently
  }
}

class PythonManager {
  constructor(callbacks = {}) {
    this._process = null;
    this._status = { running: false, healthy: false, pid: null };
    this._onLog = callbacks.onLog || (() => {});
    this._onStatusChange = callbacks.onStatusChange || (() => {});
    this._onReady = callbacks.onReady || (() => {});
    this._onError = callbacks.onError || (() => {});
    this._healthCheckTimer = null;
    this._restartTimer = null;
    this._stopping = false;
    this._startAttempts = 0;
    this._maxRestartAttempts = 5;
  }

  // ─── Find Python Binary ───────────────────────────────────
  _findPythonBinary() {
    // 1. Check for bundled agent binary (PyInstaller)
    const bundledBin = this._getBundledAgentPath();
    if (bundledBin && fs.existsSync(bundledBin)) {
      return { path: bundledBin, mode: 'bundled' };
    }

    // 2. Check for bundled Python runtime
    const bundledPython = this._getBundledPythonPath();
    if (bundledPython && fs.existsSync(bundledPython)) {
      return { path: bundledPython, mode: 'bundled-python' };
    }

    // 3. Check for project venv (development mode)
    const projectRoot = app.isPackaged
      ? path.join(process.resourcesPath, 'resources', 'agent-src')
      : path.join(__dirname, '..');

    const venvPythons = process.platform === 'win32'
      ? [path.join(projectRoot, 'venv', 'Scripts', 'python.exe')]
      : [
          path.join(projectRoot, 'venv', 'bin', 'python3'),
          path.join(projectRoot, 'venv', 'bin', 'python'),
        ];

    for (const venvPy of venvPythons) {
      if (fs.existsSync(venvPy)) {
        return { path: venvPy, mode: 'venv' };
      }
    }

    // 4. Fall back to system Python
    const systemPythons = process.platform === 'win32'
      ? ['python.exe', 'python3.exe']
      : ['python3', 'python'];

    for (const pyBin of systemPythons) {
      try {
        const { execSync } = require('child_process');
        const result = execSync(`${pyBin} --version 2>&1`, { timeout: 3000 }).toString();
        if (result.includes('Python 3')) {
          return { path: pyBin, mode: 'system' };
        }
      } catch {
        // not found, try next
      }
    }

    return null;
  }

  _getBundledAgentPath() {
    const searchDirs = [];
    if (app.isPackaged) {
      searchDirs.push(path.join(process.resourcesPath, 'resources'));
      searchDirs.push(process.resourcesPath);
    } else {
      searchDirs.push(path.join(__dirname, '..', 'resources'));
    }

    const platform = process.platform;
    for (const baseDir of searchDirs) {
      if (platform === 'win32') {
        const onedir = path.join(baseDir, 'agent-win', 'agent', 'agent.exe');
        if (fs.existsSync(onedir)) return onedir;
        const onefile = path.join(baseDir, 'agent-win', 'agent.exe');
        if (fs.existsSync(onefile)) return onefile;
      } else if (platform === 'darwin') {
        const onedir = path.join(baseDir, 'agent-mac', 'agent', 'agent');
        if (fs.existsSync(onedir)) return onedir;
        const onefile = path.join(baseDir, 'agent-mac', 'agent');
        if (fs.existsSync(onefile)) return onefile;
      } else {
        const onedir = path.join(baseDir, 'agent-linux', 'agent', 'agent');
        if (fs.existsSync(onedir)) return onedir;
        const onefile = path.join(baseDir, 'agent-linux', 'agent');
        if (fs.existsSync(onefile)) return onefile;
      }
    }
    return null;
  }

  _getBundledPythonPath() {
    const searchDirs = [];
    if (app.isPackaged) {
      searchDirs.push(path.join(process.resourcesPath, 'resources'));
      searchDirs.push(process.resourcesPath);
    } else {
      searchDirs.push(path.join(__dirname, '..', 'resources'));
    }

    const platform = process.platform;
    for (const baseDir of searchDirs) {
      if (platform === 'win32') {
        const pyPath = path.join(baseDir, 'python', 'python.exe');
        if (fs.existsSync(pyPath)) return pyPath;
      } else if (platform === 'darwin') {
        const pyPath = path.join(baseDir, 'python', 'bin', 'python3');
        if (fs.existsSync(pyPath)) return pyPath;
      }
    }
    return null;
  }

  _getWorkingDir() {
    if (app.isPackaged) {
      const srcDir = path.join(process.resourcesPath, 'resources', 'agent-src');
      if (fs.existsSync(srcDir)) return srcDir;
      const resDir = path.join(process.resourcesPath, 'resources');
      if (fs.existsSync(resDir)) return resDir;
      return process.resourcesPath;
    }
    return path.join(__dirname, '..');
  }

  // ─── Kill stale processes on our ports ───────────────────
  async _killStalePorts() {
    const ports = [AGENT_PORT, WS_PORT];
    for (const port of ports) {
      await this._killPortProcess(port);
    }
    // Small delay after killing to let OS release ports
    await new Promise(r => setTimeout(r, 300));
  }

  _killPortProcess(port) {
    return new Promise((resolve) => {
      if (process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          // Windows: find and kill PID using the port
          const out = execSync(`netstat -ano | findstr :${port}`, { timeout: 3000 }).toString();
          const lines = out.split('\n').filter(l => l.includes('LISTENING'));
          for (const line of lines) {
            const parts = line.trim().split(/\s+/);
            const pid = parts[parts.length - 1];
            if (pid && /^\d+$/.test(pid) && pid !== '0') {
              try { execSync(`taskkill /PID ${pid} /F`, { timeout: 2000 }); } catch (_) {}
            }
          }
        } catch (_) {}
        resolve();
      } else {
        // macOS/Linux: use lsof
        try {
          const { execSync } = require('child_process');
          const out = execSync(`lsof -ti :${port} 2>/dev/null`, { timeout: 3000 }).toString().trim();
          if (out) {
            const pids = out.split('\n').filter(Boolean);
            for (const pid of pids) {
              try { execSync(`kill -9 ${pid}`, { timeout: 2000 }); } catch (_) {}
            }
            this._log(`[PythonManager] Killed stale process(es) on port ${port}: ${pids.join(', ')}`);
          }
        } catch (_) {}
        resolve();
      }
    });
  }

  // ─── Check if port is truly free ─────────────────────────
  _isPortFree(port) {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => { server.close(); resolve(true); });
      server.listen(port, '127.0.0.1');
    });
  }

  // ─── Start ────────────────────────────────────────────────
  async start() {
    if (this._process) {
      this._log('[PythonManager] Already running');
      return;
    }

    this._stopping = false;

    // Kill any stale processes occupying our ports FIRST
    this._log('[PythonManager] Checking for stale processes on ports...');
    await this._killStalePorts();

    // Verify ports are actually free
    const apiPortFree = await this._isPortFree(AGENT_PORT);
    const wsPortFree = await this._isPortFree(WS_PORT);
    if (!apiPortFree || !wsPortFree) {
      const err = `Ports ${!apiPortFree ? AGENT_PORT : ''} ${!wsPortFree ? WS_PORT : ''} still occupied. Please restart Flow Kit.`;
      this._log(`[PythonManager] ERROR: ${err}`);
      this._onError(err);
      return;
    }

    const pythonInfo = this._findPythonBinary();
    if (!pythonInfo) {
      const err = 'Không thể tìm thấy công cụ xử lý video Flow Agent đi kèm ứng dụng. Vui lòng thử cài đặt lại hoặc liên hệ hỗ trợ kỹ thuật.';
      this._onError(err);
      throw new Error(err);
    }

    this._log(`[PythonManager] Using ${pythonInfo.mode} Python: ${pythonInfo.path}`);

    const env = {
      ...process.env,
      FLOW_AGENT_DIR: this._getDataDir(),
      API_HOST: AGENT_HOST,
      API_PORT: String(AGENT_PORT),
      WS_HOST: AGENT_HOST,
      WS_PORT: String(WS_PORT),
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
    };

    const cwd = pythonInfo.mode === 'bundled'
      ? path.dirname(pythonInfo.path)
      : this._getWorkingDir();
    let proc;

    if (pythonInfo.mode === 'bundled') {
      proc = spawn(pythonInfo.path, [], {
        env, cwd,
        stdio: ['ignore', 'pipe', 'pipe'],  // ignore stdin to avoid EPIPE
      });
    } else {
      proc = spawn(pythonInfo.path, ['-m', 'agent.main'], {
        env, cwd,
        stdio: ['ignore', 'pipe', 'pipe'],  // ignore stdin to avoid EPIPE
      });
    }

    this._process = proc;
    this._setStatus({ running: true, healthy: false, pid: proc.pid });

    // Log stdout — safe handler
    proc.stdout?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => this._log(line));
    });
    proc.stdout?.on('error', () => {}); // ignore pipe errors

    // Log stderr — safe handler
    proc.stderr?.on('data', (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      lines.forEach(line => {
        // Suppress known uvicorn reload warnings that are not real errors
        if (line.includes('WatchFiles') || line.includes('reload')) return;
        this._log(`[agent] ${line}`);
      });
    });
    proc.stderr?.on('error', () => {}); // ignore pipe errors

    // Handle exit
    proc.on('exit', (code, signal) => {
      this._log(`[PythonManager] Process exited (code=${code}, signal=${signal})`);
      this._process = null;
      this._setStatus({ running: false, healthy: false, pid: null });
      this._stopHealthCheck();

      if (this._stopping) return;

      // Only auto-restart on non-zero exit (error), not normal exit
      if (code !== 0 && code !== null) {
        this._startAttempts++;
        if (this._startAttempts >= this._maxRestartAttempts) {
          const err = `Agent failed to start after ${this._maxRestartAttempts} attempts. Check Python dependencies.`;
          this._log(`[PythonManager] ERROR: ${err}`);
          this._onError(err);
          return;
        }
        const delay = Math.min(3000 * this._startAttempts, 15000);
        this._log(`[PythonManager] Scheduling restart in ${delay}ms (attempt ${this._startAttempts}/${this._maxRestartAttempts})...`);
        this._restartTimer = setTimeout(() => this.start(), delay);
      } else {
        this._startAttempts = 0;
      }
    });

    proc.on('error', (err) => {
      this._log(`[PythonManager] Process error: ${err.message}`);
      this._onError(err.message);
    });

    // Wait for agent to be healthy
    this._log('[PythonManager] Waiting for agent to be ready...');
    try {
      await this._waitForHealth();
      this._startAttempts = 0; // Reset on success
    } catch (err) {
      this._log(`[PythonManager] Startup failed: ${err.message}`);
      throw err;
    }
  }

  // ─── Stop ─────────────────────────────────────────────────
  async stop() {
    this._stopping = true;
    this._stopHealthCheck();

    if (this._restartTimer) {
      clearTimeout(this._restartTimer);
      this._restartTimer = null;
    }

    if (!this._process) return;

    return new Promise((resolve) => {
      const proc = this._process;
      const timeout = setTimeout(() => {
        this._log('[PythonManager] Force killing Python process...');
        try { proc.kill('SIGKILL'); } catch (_) {}
        resolve();
      }, 5000);

      proc.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });

      this._log('[PythonManager] Stopping Python agent...');
      try { proc.kill('SIGTERM'); } catch (_) {}
    });
  }

  // ─── Restart ──────────────────────────────────────────────
  async restart() {
    this._log('[PythonManager] Restarting...');
    this._startAttempts = 0;
    await this.stop();
    this._stopping = false;
    await new Promise(r => setTimeout(r, 800));
    await this.start();
  }

  // ─── Health Check ─────────────────────────────────────────
  async _waitForHealth() {
    let retries = 0;

    return new Promise((resolve, reject) => {
      const check = () => {
        if (this._stopping) {
          reject(new Error('Stopping'));
          return;
        }
        if (!this._process) {
          // Process died before becoming healthy
          reject(new Error('Agent process exited before becoming healthy'));
          return;
        }

        this._checkHealth()
          .then((healthy) => {
            if (healthy) {
              this._setStatus({ running: true, healthy: true, pid: this._process?.pid });
              this._log('[PythonManager] Agent is ready! ✓');
              this._onReady();
              this._startPeriodicHealthCheck();
              resolve();
            } else {
              retries++;
              if (retries >= MAX_RETRIES) {
                reject(new Error('Agent did not start in time (30s timeout)'));
              } else {
                this._healthCheckTimer = setTimeout(check, HEALTH_CHECK_INTERVAL_MS);
              }
            }
          })
          .catch(() => {
            retries++;
            if (retries >= MAX_RETRIES) {
              reject(new Error('Agent health check timed out'));
            } else {
              this._healthCheckTimer = setTimeout(check, HEALTH_CHECK_INTERVAL_MS);
            }
          });
      };

      check();
    });
  }

  _checkHealth() {
    return new Promise((resolve) => {
      const req = http.get(HEALTH_URL, { timeout: 2000 }, (res) => {
        // Consume response body to avoid memory leaks
        res.resume();
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
    });
  }

  _startPeriodicHealthCheck() {
    this._healthCheckTimer = setInterval(async () => {
      if (this._stopping) return;
      const healthy = await this._checkHealth();
      if (this._status.healthy !== healthy) {
        this._setStatus({ ...this._status, healthy });
      }
    }, 10_000);
  }

  _stopHealthCheck() {
    if (this._healthCheckTimer) {
      clearInterval(this._healthCheckTimer);
      clearTimeout(this._healthCheckTimer);
      this._healthCheckTimer = null;
    }
  }

  // ─── Data Directory ───────────────────────────────────────
  _getDataDir() {
    const userDataPath = app.getPath('userData');
    const dataDir = path.join(userDataPath, 'agent-data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    return dataDir;
  }

  // ─── Helpers ─────────────────────────────────────────────
  _log(msg) {
    safeLog(msg);
    this._onLog(msg);
  }

  _setStatus(status) {
    this._status = status;
    this._onStatusChange(status);
  }

  getStatus() {
    return { ...this._status };
  }
}

module.exports = { PythonManager };
