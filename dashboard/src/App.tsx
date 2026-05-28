import { useState } from 'react'
import { HashRouter, NavLink, Routes, Route, useLocation, useNavigate, useParams } from 'react-router-dom'
import {
  LayoutDashboard, FolderOpen, ScrollText, Film, Image as ImageIcon,
  Globe, Settings, Zap, Clapperboard, Wifi, WifiOff, Plug, PlugZap, AudioWaveform
} from 'lucide-react'
import { useWebSocket } from './api/useWebSocket'
import { useHealthStatus } from './api/useHealthStatus'
import DashboardPage from './pages/DashboardPage'
import ProjectsPage from './pages/ProjectsPage'
import LogsPage from './pages/LogsPage'
import GalleryPage from './pages/GalleryPage'
import BrowserPage from './pages/BrowserPage'
import SettingsPage from './pages/SettingsPage'
import StudioPage from './pages/StudioPage'
import VideoDetailPage from './pages/VideoDetailPage'
import BatchImagePage from './pages/BatchImagePage'
import BatchVideoPage from './pages/BatchVideoPage'
import SplashScreen from './components/electron/SplashScreen'
import ExtensionBanner from './components/electron/ExtensionBanner'
import TTSStudioPage from './pages/TTSStudioPage'
import LicenseGate from './components/electron/LicenseGate'

const isElectron = typeof window !== 'undefined' && !!(window as unknown as { electronAPI?: unknown }).electronAPI
const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')

const NAV = [
  { to: '/', icon: LayoutDashboard, label: 'Tổng quan', exact: true },
  { to: '/projects', icon: FolderOpen, label: 'Dự án', exact: false },
  { to: '/logs', icon: ScrollText, label: 'Nhật ký', exact: false },
  { to: '/gallery', icon: Film, label: 'Thư viện', exact: false },
  { to: '/browser', icon: Globe, label: 'Trình duyệt', exact: false },
  { to: '/settings', icon: Settings, label: 'Cài đặt', exact: false },
]

function TieuDeTrang() {
  const loc = useLocation()
  if (loc.pathname.startsWith('/studio/')) return (
    <span className="flex items-center gap-1.5">
      <Clapperboard size={14} />
      Studio
    </span>
  )
  if (loc.pathname.startsWith('/videos/')) return (
    <span className="flex items-center gap-1.5">
      <Film size={14} />
      Chi tiết tập phim
    </span>
  )
  if (loc.pathname.includes('/batch-images')) return (
    <span className="flex items-center gap-1.5">
      <ImageIcon size={14} />
      Batch Image Studio
    </span>
  )
  if (loc.pathname.includes('/batch-videos')) return (
    <span className="flex items-center gap-1.5">
      <Film size={14} />
      Batch Video Studio
    </span>
  )
  if (loc.pathname.startsWith('/tts-studio')) return (
    <span className="flex items-center gap-1.5">
      <AudioWaveform size={14} />
      TTS Studio
    </span>
  )
  const match = NAV.find(n => n.exact ? loc.pathname === n.to : loc.pathname.startsWith(n.to))
  return match ? (
    <span className="flex items-center gap-1.5">
      <match.icon size={14} />
      {match.label}
    </span>
  ) : <span>Flow Kit</span>
}

function StudioPageWrapper() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  if (!id) return null
  return <StudioPage projectId={id} onBack={() => navigate('/projects')} />
}

function Layout() {
  const { isConnected } = useWebSocket()
  const { extensionConnected } = useHealthStatus()

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: 'var(--bg)', color: 'var(--text)' }}>

      {/* ── Sidebar ── */}
      <aside
        className="flex-shrink-0 flex flex-col"
        style={{
          width: 196,
          background: 'var(--sidebar)',
          borderRight: '1px solid var(--border-subtle)',
        }}
      >
        {/* macOS drag region */}
        {isElectron && isMac && (
          <div style={{ height: 28, WebkitAppRegion: 'drag', flexShrink: 0 } as React.CSSProperties} />
        )}

        {/* Logo */}
        <div
          className="flex items-center gap-2 px-4"
          style={{
            height: isElectron && isMac ? 36 : 52,
            borderBottom: '1px solid var(--border-subtle)',
          }}
        >
          <div
            className="flex items-center justify-center rounded-lg"
            style={{
              width: 26, height: 26,
              background: 'var(--gradient-accent-v)',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(124,91,245,0.4)',
            }}
          >
            <Zap size={13} color="#fff" strokeWidth={2.5} />
          </div>
          <div>
            <div className="font-bold text-sm tracking-tight" style={{ color: 'var(--text)' }}>
              Flowkit
            </div>
            <div style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.01em', fontWeight: 500 }}>by AWEMEDIA</div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-col gap-0.5 px-2 py-3 flex-1 overflow-y-auto">
          {NAV.filter(n => n.to !== '/settings').map(({ to, icon: Icon, label, exact }) => (
            <NavLink
              key={to}
              to={to}
              end={exact}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-2.5 py-2 rounded text-sm transition-all ${
                  isActive ? 'font-medium' : 'hover:opacity-90'
                }`
              }
              style={({ isActive }) => ({
                background: isActive ? 'var(--accent-subtle)' : 'transparent',
                color: isActive ? '#a48ef8' : 'var(--muted)',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                marginLeft: -2,
                paddingLeft: 10,
                borderRadius: 6,
              })}
            >
              <Icon size={16} />
              {label}
            </NavLink>
          ))}

          {/* Batch Links */}
          <div
            className="px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase"
            style={{ color: 'var(--muted)', marginTop: 14, marginBottom: 2 }}
          >
            Batch Studio
          </div>
          <NavLink
            to="/batch-images"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-2.5 py-2 rounded text-sm transition-all ${
                isActive ? 'font-medium' : 'hover:opacity-90'
              }`
            }
            style={({ isActive }) => ({
              background: isActive ? 'var(--accent-subtle)' : 'transparent',
              color: isActive ? '#a48ef8' : 'var(--muted)',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginLeft: -2,
              paddingLeft: 10,
              borderRadius: 6,
            })}
          >
            <ImageIcon size={16} />
            Batch Ảnh
          </NavLink>
          <NavLink
            to="/batch-videos"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-2.5 py-2 rounded text-sm transition-all ${
                isActive ? 'font-medium' : 'hover:opacity-90'
              }`
            }
            style={({ isActive }) => ({
              background: isActive ? 'var(--accent-subtle)' : 'transparent',
              color: isActive ? '#a48ef8' : 'var(--muted)',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginLeft: -2,
              paddingLeft: 10,
              borderRadius: 6,
            })}
          >
            <Film size={16} />
            Batch Video
          </NavLink>

          {/* TTS Studio */}
          <div
            className="px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase"
            style={{ color: 'var(--muted)', marginTop: 14, marginBottom: 2 }}
          >
            TTS
          </div>
          <NavLink
            to="/tts-studio"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-2.5 py-2 rounded text-sm transition-all ${
                isActive ? 'font-medium' : 'hover:opacity-90'
              }`
            }
            style={({ isActive }) => ({
              background: isActive ? 'var(--accent-subtle)' : 'transparent',
              color: isActive ? '#a48ef8' : 'var(--muted)',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginLeft: -2,
              paddingLeft: 10,
              borderRadius: 6,
            })}
          >
            <AudioWaveform size={16} />
            TTS Studio
          </NavLink>

          {/* Cài đặt (Đặt cuối cùng) */}
          <div
            className="px-2.5 py-1 text-[9px] font-bold tracking-wider uppercase"
            style={{ color: 'var(--muted)', marginTop: 14, marginBottom: 2 }}
          >
            Hệ thống
          </div>
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2.5 px-2.5 py-2 rounded text-sm transition-all ${
                isActive ? 'font-medium' : 'hover:opacity-90'
              }`
            }
            style={({ isActive }) => ({
              background: isActive ? 'var(--accent-subtle)' : 'transparent',
              color: isActive ? '#a48ef8' : 'var(--muted)',
              borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
              marginLeft: -2,
              paddingLeft: 10,
              borderRadius: 6,
            })}
          >
            <Settings size={16} />
            Cài đặt
          </NavLink>
        </nav>

        {/* Status bar */}
        <div
          className="px-3 py-3 flex flex-col gap-1.5"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            {isConnected
              ? <Wifi size={13} color="var(--green)" />
              : <WifiOff size={13} color="var(--red)" />
            }
            <span style={{ fontSize: 12, color: isConnected ? 'var(--green)' : 'var(--red)' }}>
              {isConnected ? 'Agent đang chạy' : 'Mất kết nối'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {extensionConnected
              ? <PlugZap size={13} color="var(--green)" />
              : <Plug size={13} color="var(--yellow)" />
            }
            <span style={{ fontSize: 12, color: extensionConnected ? 'var(--green)' : 'var(--yellow)' }}>
              {extensionConnected ? 'Extension OK' : 'Chưa kết nối'}
            </span>
          </div>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex flex-col flex-1 overflow-hidden">

        {/* Header */}
        <header
          className="flex items-center justify-between flex-shrink-0"
          style={{
            background: 'var(--sidebar)',
            borderBottom: '1px solid var(--border-subtle)',
            borderTop: '2px solid transparent',
            backgroundImage: 'linear-gradient(var(--sidebar), var(--sidebar)), var(--gradient-accent)',
            backgroundOrigin: 'border-box',
            backgroundClip: 'padding-box, border-box',
            height: isElectron && isMac ? 52 : 44,
            paddingTop: isElectron && isMac ? 8 : 0,
            paddingLeft: 20,
            paddingRight: 16,
            WebkitAppRegion: isElectron ? 'drag' : 'initial',
          } as React.CSSProperties}
        >
          <span
            className="text-sm font-semibold"
            style={{ color: 'var(--text)', WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <TieuDeTrang />
          </span>

          <div
            className="flex items-center gap-3"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <span
              className="flex items-center gap-1.5 text-xs"
              style={{ color: isConnected ? 'var(--green)' : 'var(--red)' }}
              title={isConnected ? 'WebSocket đang kết nối' : 'Mất kết nối WebSocket'}
            >
              <span
                className="inline-block rounded-full"
                style={{
                  width: 6, height: 6,
                  background: isConnected ? 'var(--green)' : 'var(--red)',
                  boxShadow: isConnected ? '0 0 6px var(--green)' : 'none',
                }}
              />
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                {isConnected ? 'Đã kết nối' : 'Mất kết nối'}
              </span>
            </span>
          </div>
        </header>

        {/* Extension banner */}
        {isElectron && (
          <div style={{ paddingLeft: 20, paddingRight: 20, paddingTop: 8, flexShrink: 0 }}>
            <ExtensionBanner isConnected={extensionConnected} />
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-auto" style={{ padding: '20px 20px' }}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:id" element={<ProjectsPage />} />
            <Route path="/videos/:vid" element={<VideoDetailPage />} />
            <Route path="/studio/:id" element={<StudioPageWrapper />} />
            <Route path="/batch-images" element={<BatchImagePage />} />
            <Route path="/batch-images/:id/:vid" element={<BatchImagePage />} />
            <Route path="/batch-videos" element={<BatchVideoPage />} />
            <Route path="/batch-videos/:id/:vid" element={<BatchVideoPage />} />
            <Route path="/tts-studio" element={<TTSStudioPage />} />
            <Route path="/logs" element={<LogsPage />} />
            <Route path="/gallery" element={<GalleryPage />} />
            <Route path="/browser" element={<BrowserPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </main>
      </div>
    </div>
  )
}

export default function App() {
  const [agentSanSang, setAgentSanSang] = useState(!isElectron)

  return (
    <>
      {isElectron && !agentSanSang && (
        <SplashScreen onReady={() => setAgentSanSang(true)} />
      )}
      <div style={{ display: agentSanSang ? 'block' : 'none', height: '100vh' }}>
        <HashRouter>
          <LicenseGate>
            <Layout />
          </LicenseGate>
        </HashRouter>
      </div>
    </>
  )
}
