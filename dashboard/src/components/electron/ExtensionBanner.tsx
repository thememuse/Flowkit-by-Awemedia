import { AlertTriangle, ExternalLink, Globe } from 'lucide-react'

interface ExtensionBannerProps {
  isConnected: boolean
}

export default function ExtensionBanner({ isConnected }: ExtensionBannerProps) {
  if (isConnected) return null

  const handleMoExtension = () => {
    window.history.pushState({}, '', '/browser')
    window.dispatchEvent(new PopStateEvent('popstate'))
  }

  const handleXemHuongDan = () => {
    window.electronAPI?.openExternal(
      'https://github.com/your-repo/flowkit#cai-dat-extension'
    )
  }

  return (
    <div
      style={{
        background: 'linear-gradient(135deg, rgba(245,158,11,0.08), rgba(239,68,68,0.06))',
        border: '1px solid rgba(245,158,11,0.25)',
        borderRadius: 8,
        padding: '9px 14px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
      }}
    >
      <AlertTriangle size={14} color="var(--yellow)" strokeWidth={2} style={{ flexShrink: 0 }} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--yellow)', marginBottom: 1 }}>
          Chưa kết nối Extension Chrome
        </div>
        <div style={{ fontSize: 10, color: 'var(--muted)', lineHeight: 1.5 }}>
          Mở tab <strong style={{ color: 'var(--yellow)' }}>Trình duyệt</strong> → nhấn{' '}
          <strong>"Mở Google Flow"</strong> để khởi động và kết nối extension tự động.
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button
          onClick={handleMoExtension}
          className="flex items-center gap-1"
          style={{
            padding: '4px 10px',
            borderRadius: 5,
            background: 'rgba(245,158,11,0.15)',
            border: '1px solid rgba(245,158,11,0.3)',
            color: 'var(--yellow)',
            fontSize: 10,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          <Globe size={10} />
          Mở Trình duyệt
        </button>
        <button
          onClick={handleXemHuongDan}
          className="flex items-center gap-1"
          style={{
            padding: '4px 10px',
            borderRadius: 5,
            background: 'transparent',
            border: '1px solid rgba(100,116,139,0.3)',
            color: 'var(--muted)',
            fontSize: 10,
            fontWeight: 600,
            whiteSpace: 'nowrap',
          }}
        >
          <ExternalLink size={10} />
          Hướng dẫn
        </button>
      </div>
    </div>
  )
}
