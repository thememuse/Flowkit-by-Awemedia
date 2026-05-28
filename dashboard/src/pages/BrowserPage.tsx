import BrowserPanel from '../components/browser/BrowserPanel'

export default function BrowserPage() {
  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text)', margin: 0, marginBottom: 6 }}>
          Trình duyệt tích hợp
        </h1>
        <p style={{ fontSize: 12, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
          Mở Google Flow trong trình duyệt Chromium riêng — session đăng nhập được lưu tự động.
          Extension Flow Kit được cài sẵn để kết nối với agent.
        </p>
      </div>
      <BrowserPanel />
    </div>
  )
}
