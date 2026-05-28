import { useState, useEffect } from 'react'
import type { PythonStatus } from '../../types/electron'

interface SplashScreenProps {
  onReady: () => void
}

export default function SplashScreen({ onReady }: SplashScreenProps) {
  const [logs, setLogs] = useState<string[]>([])
  const [status, setStatus] = useState<PythonStatus>({ running: false, healthy: false, pid: null })
  const [error, setError] = useState<string | null>(null)
  const [dots, setDots] = useState('')

  const electronAPI = window.electronAPI

  useEffect(() => {
    if (!electronAPI) {
      // Not in Electron, skip splash
      onReady()
      return
    }

    // Animate dots
    const dotsInterval = setInterval(() => {
      setDots(d => d.length >= 3 ? '' : d + '.')
    }, 400)

    // Subscribe to Python events
    const unsubLog = electronAPI.onPythonLog((line) => {
      setLogs(prev => [...prev.slice(-50), line])
    })

    const unsubStatus = electronAPI.onPythonStatusChange((s) => {
      setStatus(s)
    })

    const unsubReady = electronAPI.onPythonReady(() => {
      clearInterval(dotsInterval)
      setTimeout(onReady, 500)
    })

    const unsubError = electronAPI.onPythonError((err) => {
      setError(err)
    })

    // Check current status
    electronAPI.getPythonStatus().then((s) => {
      setStatus(s)
      if (s.healthy) {
        clearInterval(dotsInterval)
        onReady()
      }
    })

    return () => {
      clearInterval(dotsInterval)
      unsubLog()
      unsubStatus()
      unsubReady()
      unsubError()
    }
  }, [])

  const handleRetry = async () => {
    setError(null)
    setLogs([])
    await electronAPI?.restartPython()
  }

  const getStatusText = () => {
    if (error) return 'Khởi động thất bại'
    if (status.healthy) return 'Sẵn sàng!'
    if (status.running) return `Đang khởi động agent${dots}`
    return `Đang khởi tạo${dots}`
  }

  const getStatusColor = () => {
    if (error) return '#ef4444'
    if (status.healthy) return '#22c55e'
    return '#3b82f6'
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--bg)',
        zIndex: 9999,
        fontFamily: "'DM Mono', 'Fira Code', monospace",
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    >
      {/* Logo / Tiêu đề */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div
          style={{
            width: 72,
            height: 72,
            borderRadius: '20px',
            background: 'linear-gradient(135deg, #1e3a5f, #3b82f6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
            fontSize: 32,
            boxShadow: '0 0 40px rgba(59,130,246,0.3)',
            animation: !status.healthy && !error ? 'fk-pulse 2s ease-in-out infinite' : 'none',
          }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </div>
        <div style={{ fontSize: 24, fontWeight: 700, color: '#e2e8f0', letterSpacing: 2 }}>
          FLOW KIT
        </div>
        <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, letterSpacing: 1 }}>
          PHẦN MỀM SẢN XUẤT VIDEO AI
        </div>
      </div>

      {/* Status indicator */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 24,
          padding: '8px 20px',
          borderRadius: 100,
          background: 'rgba(255,255,255,0.05)',
          border: `1px solid ${getStatusColor()}40`,
        }}
      >
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: getStatusColor(),
            animation: !status.healthy && !error ? 'fk-ping 1.5s ease-in-out infinite' : 'none',
          }}
        />
        <span style={{ fontSize: 12, color: getStatusColor(), fontWeight: 600 }}>
          {getStatusText()}
        </span>
      </div>

      {/* Trạng thái lỗi */}
      {error && (
        <div
          style={{
            maxWidth: 480,
            padding: '16px 20px',
            borderRadius: 10,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            marginBottom: 16,
            textAlign: 'center',
          }}
        >
          <div style={{ color: '#ef4444', fontSize: 12, marginBottom: 8 }}>{error}</div>
          <div style={{ color: '#64748b', fontSize: 11, marginBottom: 12 }}>
            Không thể khởi động hệ thống xử lý video ngầm.<br />
            Vui lòng tắt hoàn toàn ứng dụng và khởi động lại, hoặc liên hệ đội ngũ hỗ trợ kỹ thuật.
          </div>
          <button
            onClick={handleRetry}
            style={{
              padding: '6px 16px',
              borderRadius: 6,
              background: '#3b82f6',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
              WebkitAppRegion: 'no-drag',
            } as React.CSSProperties}
          >
            Thử lại
          </button>
        </div>
      )}

      {/* Log khởi động */}
      {logs.length > 0 && (
        <div
          style={{
            width: 520,
            maxHeight: 160,
            overflowY: 'auto',
            background: 'rgba(0,0,0,0.4)',
            border: '1px solid #252545',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 10,
            color: '#475569',
            fontFamily: 'monospace',
            lineHeight: 1.6,
            WebkitAppRegion: 'no-drag',
          } as React.CSSProperties}
        >
          {logs.map((line, i) => (
            <div key={i} style={{ color: line.toLowerCase().includes('error') ? '#ef4444' : '#475569' }}>
              {line}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes fk-pulse {
          0%, 100% { transform: scale(1); box-shadow: 0 0 40px rgba(59,130,246,0.3); }
          50% { transform: scale(1.05); box-shadow: 0 0 60px rgba(59,130,246,0.5); }
        }
        @keyframes fk-ping {
          0% { transform: scale(1); opacity: 1; }
          80%, 100% { transform: scale(2); opacity: 0; }
        }
      `}</style>
    </div>
  )
}
