import { useState, useEffect } from 'react'
import type { BrowserStatus } from '../../types/electron'

const GOOGLE_FLOW_URL = 'https://labs.google/fx/tools/flow'

export default function BrowserPanel() {
  const [status, setStatus] = useState<BrowserStatus>({ open: false, url: null, loggedIn: false })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const electronAPI = window.electronAPI

  useEffect(() => {
    if (!electronAPI) return

    // Lấy trạng thái hiện tại
    electronAPI.getBrowserStatus().then(setStatus)

    // Lắng nghe thay đổi trạng thái
    const unsub = electronAPI.onBrowserStatusChange(setStatus)
    return unsub
  }, [])

  const handleMoBrowser = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await electronAPI?.openBrowser(GOOGLE_FLOW_URL)
      if (result && !result.ok) {
        setError(result.error || 'Không thể mở trình duyệt')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lỗi không xác định')
    } finally {
      setLoading(false)
    }
  }

  const handleDongBrowser = async () => {
    setLoading(true)
    try {
      await electronAPI?.closeBrowser()
    } finally {
      setLoading(false)
    }
  }

  const handleXoaSession = async () => {
    if (!window.confirm('Xóa dữ liệu đăng nhập? Bạn sẽ cần đăng nhập lại vào Google Flow.')) return
    setLoading(true)
    try {
      await electronAPI?.clearBrowserSession()
      setStatus({ open: false, url: null, loggedIn: false })
    } finally {
      setLoading(false)
    }
  }

  if (!electronAPI) {
    return (
      <div style={{ padding: '20px', color: 'var(--muted)', fontSize: 12 }}>
        Chức năng trình duyệt chỉ khả dụng trong ứng dụng desktop.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Trạng thái trình duyệt */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '16px 20px',
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', marginBottom: 12, letterSpacing: 1, textTransform: 'uppercase' }}>
          Trạng thái trình duyệt
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          {/* Đèn trạng thái */}
          <div style={{
            width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
            background: status.open
              ? (status.loggedIn ? 'var(--green)' : '#f59e0b')
              : 'var(--muted)',
            boxShadow: status.open ? '0 0 8px currentColor' : 'none',
          }} />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              {status.open
                ? (status.loggedIn ? '✓ Đã đăng nhập Google' : '⚠ Chưa đăng nhập')
                : 'Trình duyệt đang đóng'}
            </div>
            {status.url && (
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 2, fontFamily: 'monospace' }}>
                {status.url.length > 60 ? status.url.substring(0, 60) + '...' : status.url}
              </div>
            )}
          </div>
        </div>

        {/* Hướng dẫn khi chưa đăng nhập */}
        {status.open && !status.loggedIn && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 7,
            background: 'rgba(245,158,11,0.08)',
            border: '1px solid rgba(245,158,11,0.25)',
            fontSize: 11,
            color: '#f59e0b',
            lineHeight: 1.6,
          }}>
            📌 Vui lòng đăng nhập vào tài khoản Google trong cửa sổ trình duyệt.<br />
            Flow Kit sẽ lưu phiên đăng nhập để không cần đăng nhập lại.
          </div>
        )}

        {/* Thông báo đã đăng nhập */}
        {status.open && status.loggedIn && (
          <div style={{
            padding: '10px 12px',
            borderRadius: 7,
            background: 'rgba(34,197,94,0.08)',
            border: '1px solid rgba(34,197,94,0.25)',
            fontSize: 11,
            color: 'var(--green)',
            lineHeight: 1.6,
          }}>
            ✓ Extension đã kết nối và sẵn sàng. Flow Kit có thể tạo ảnh/video qua Google Flow.
          </div>
        )}
      </div>

      {/* Nút điều khiển */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!status.open ? (
          <button
            onClick={handleMoBrowser}
            disabled={loading}
            style={{
              flex: 1,
              padding: '10px 16px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
              color: '#fff',
              border: 'none',
              cursor: loading ? 'wait' : 'pointer',
              fontSize: 13,
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: loading ? 0.7 : 1,
              transition: 'opacity 0.2s, transform 0.15s',
            }}
            onMouseEnter={e => { if (!loading) (e.target as HTMLButtonElement).style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => { (e.target as HTMLButtonElement).style.transform = 'translateY(0)' }}
          >
            <span style={{ fontSize: 16 }}>🌐</span>
            {loading ? 'Đang mở...' : 'Mở Google Flow'}
          </button>
        ) : (
          <>
            <button
              onClick={handleMoBrowser}
              disabled={loading}
              style={{
                flex: 1,
                padding: '9px 14px',
                borderRadius: 8,
                background: 'var(--card)',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Focus cửa sổ ↗
            </button>
            <button
              onClick={handleDongBrowser}
              disabled={loading}
              style={{
                flex: 1,
                padding: '9px 14px',
                borderRadius: 8,
                background: 'var(--card)',
                color: 'var(--muted)',
                border: '1px solid var(--border)',
                cursor: loading ? 'wait' : 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Đóng trình duyệt
            </button>
          </>
        )}
      </div>

      {/* Lỗi */}
      {error && (
        <div style={{
          padding: '10px 14px',
          borderRadius: 8,
          background: 'rgba(239,68,68,0.1)',
          border: '1px solid rgba(239,68,68,0.3)',
          color: '#ef4444',
          fontSize: 11,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Thông tin về extension */}
      <div
        style={{
          background: 'var(--card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 18px',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 10, letterSpacing: 1, textTransform: 'uppercase' }}>
          Extension Chrome
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
          Extension được tự động tải vào trình duyệt Chromium khi bạn nhấn "Mở Google Flow".<br />
          Extension kết nối với Flow Kit Agent qua{' '}
          <code style={{ color: 'var(--accent)', fontSize: 10 }}>ws://127.0.0.1:9222</code>.
        </div>

        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8 }}>
          <button
            onClick={handleXoaSession}
            disabled={loading || status.open}
            title={status.open ? 'Đóng trình duyệt trước khi xóa session' : ''}
            style={{
              padding: '5px 12px',
              borderRadius: 6,
              background: 'transparent',
              color: status.open ? 'var(--border)' : '#ef4444',
              border: `1px solid ${status.open ? 'var(--border)' : 'rgba(239,68,68,0.4)'}`,
              cursor: status.open ? 'not-allowed' : 'pointer',
              fontSize: 11,
            }}
          >
            Xóa dữ liệu đăng nhập
          </button>
        </div>
      </div>

      {/* Hướng dẫn nhanh */}
      <div
        style={{
          background: 'rgba(59,130,246,0.05)',
          border: '1px solid rgba(59,130,246,0.15)',
          borderRadius: 10,
          padding: '14px 18px',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
          💡 Hướng dẫn sử dụng lần đầu
        </div>
        <ol style={{ fontSize: 11, color: 'var(--muted)', lineHeight: 1.8, margin: 0, paddingLeft: 16 }}>
          <li>Nhấn <strong style={{ color: 'var(--text)' }}>Mở Google Flow</strong> để khởi động trình duyệt</li>
          <li>Đăng nhập tài khoản Google trong cửa sổ trình duyệt</li>
          <li>Flow Kit sẽ tự động lưu session đăng nhập</li>
          <li>Extension sẽ kết nối tự động — đèn chuyển xanh là sẵn sàng</li>
          <li>Quay lại Flow Kit và bắt đầu tạo video!</li>
        </ol>
      </div>
    </div>
  )
}
