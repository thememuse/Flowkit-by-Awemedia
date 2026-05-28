/**
 * Khai báo TypeScript cho Electron IPC APIs.
 * Có sẵn tại window.electronAPI trong renderer.
 */

export interface PythonStatus {
  running: boolean
  healthy: boolean
  pid: number | null
}

export interface BrowserStatus {
  open: boolean
  url: string | null
  loggedIn: boolean
}

export interface LicenseStatus {
  active: boolean
  key?: string
  expiresAt?: string
  durationType?: string
  machineId: string
  error?: string
}

export interface LicenseActivationResult {
  ok: boolean
  durationType?: string
  expiresAt?: string
  error?: string
}

export interface ElectronAPI {
  // ── Python Agent ──────────────────────────────────────
  getPythonStatus: () => Promise<PythonStatus>
  restartPython: () => Promise<{ ok: boolean; error?: string }>
  onPythonLog: (cb: (line: string) => void) => () => void
  onPythonStatusChange: (cb: (status: PythonStatus) => void) => () => void
  onPythonReady: (cb: () => void) => () => void
  onPythonError: (cb: (error: string) => void) => () => void

  // ── Trình duyệt ───────────────────────────────────────
  openBrowser: (url?: string) => Promise<{ ok: boolean; error?: string }>
  closeBrowser: () => Promise<{ ok: boolean; error?: string }>
  getBrowserStatus: () => Promise<BrowserStatus>
  clearBrowserSession: () => Promise<{ ok: boolean; error?: string }>
  onBrowserStatusChange: (cb: (status: BrowserStatus) => void) => () => void

  // ── Bản quyền (License) ──────────────────────────────
  getMachineId: () => Promise<string>
  getLicenseStatus: () => Promise<LicenseStatus>
  activateLicense: (key: string) => Promise<LicenseActivationResult>

  // ── Thông tin App ─────────────────────────────────────
  getVersion: () => Promise<string>

  // ── Thao tác hệ thống ─────────────────────────────────
  openExternal: (url: string) => Promise<void>
  showOpenDialog: (options: object) => Promise<{ canceled: boolean; filePaths: string[] }>
  showSaveDialog: (options: object) => Promise<{ canceled: boolean; filePath?: string }>
  revealFile: (filePath: string) => Promise<void>

  // ── Cửa sổ ───────────────────────────────────────────
  minimizeWindow: () => Promise<void>
  hideWindow: () => Promise<void>

  // ── Nền tảng ─────────────────────────────────────────
  platform: 'darwin' | 'win32' | 'linux'
  isElectron: true
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI
  }
}
