import React, { useState, useEffect } from 'react'
import { KeyRound, ShieldAlert, Cpu, Clipboard, Check, Sparkles, RefreshCw } from 'lucide-react'
import type { LicenseStatus } from '../../types/electron'

interface LicenseGateProps {
  children: React.ReactNode
}

export default function LicenseGate({ children }: LicenseGateProps) {
  const [license, setLicense] = useState<LicenseStatus | null>(null)
  const [checking, setChecking] = useState(true)
  const [activationKey, setActivationKey] = useState('')
  const [activating, setActivating] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const electronAPI = window.electronAPI

  const loadLicenseStatus = async () => {
    if (!electronAPI) {
      // Offline / Non-electron mode (web preview) -> Tự động cho qua để tiện preview
      setLicense({ active: true, machineId: 'web-preview-id' })
      setChecking(false)
      return
    }

    try {
      const status = await electronAPI.getLicenseStatus()
      setLicense(status)
    } catch (_) {
      setLicense({ active: false, machineId: 'unknown-machine-id', error: 'Không thể truy vấn thông tin bản quyền!' })
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    loadLicenseStatus()
  }, [])

  const handleCopyMachineId = () => {
    if (!license?.machineId) return
    navigator.clipboard.writeText(license.machineId)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activationKey.trim()) {
      setErrorMsg('Vui lòng nhập khóa kích hoạt bản quyền!')
      return
    }

    setErrorMsg(null)
    setSuccessMsg(null)
    setActivating(true)

    try {
      const result = await electronAPI?.activateLicense(activationKey.trim())
      if (result && result.ok) {
        setSuccessMsg(`Kích hoạt thành công! Gói: ${result.durationType} — Hạn sử dụng: ${result.expiresAt}`)
        setTimeout(() => {
          // Làm mới trạng thái bản quyền sau 1.5s để người dùng vào ứng dụng
          loadLicenseStatus()
        }, 1500)
      } else {
        setErrorMsg(result?.error || 'Khóa kích hoạt không hợp lệ hoặc đã được dùng trên máy khác!')
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Đã xảy ra lỗi không xác định!')
    } finally {
      setActivating(false)
    }
  }

  // 1. Đang kiểm tra bản quyền ngầm lúc mở app
  if (checking) {
    return (
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#07080c',
          gap: 16,
        }}
      >
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyItems: 'center' }}>
          <div
            style={{
              width: 54, height: 54,
              borderRadius: '50%',
              border: '3px solid rgba(124,91,245,0.1)',
              borderTopColor: '#7c5bf5',
              animation: 'spin 1s linear infinite',
            }}
          />
          <KeyRound size={20} color="#7c5bf5" style={{ position: 'absolute', left: 17, top: 17 }} />
        </div>
        <div style={{ fontSize: 13, color: '#9298b8', letterSpacing: '0.05em' }}>
          Đang xác thực bản quyền Flowkit...
        </div>
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    )
  }

  // 2. Đã kích hoạt bản quyền thành công -> Hiển thị ứng dụng bình thường
  if (license && license.active) {
    return <>{children}</>
  }

  // 3. Chưa kích hoạt hoặc hết hạn bản quyền -> Khóa đứng app và hiển thị giao diện kích hoạt
  return (
    <div
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#07080c',
        backgroundImage: 'radial-gradient(circle at 50% 20%, rgba(124,91,245,0.15) 0%, transparent 60%)',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Background neon elements */}
      <div style={{
        position: 'absolute', width: 250, height: 250, borderRadius: '50%',
        background: '#7c5bf5', filter: 'blur(120px)', opacity: 0.15,
        left: '10%', top: '20%'
      }} />
      <div style={{
        position: 'absolute', width: 250, height: 250, borderRadius: '50%',
        background: '#00d2ff', filter: 'blur(120px)', opacity: 0.1,
        right: '10%', bottom: '20%'
      }} />

      {/* Activation Panel Box */}
      <div
        style={{
          width: '100%',
          maxWidth: 460,
          background: 'rgba(24, 28, 40, 0.65)',
          backdropFilter: 'blur(20px)',
          border: '1px solid rgba(255, 255, 255, 0.07)',
          borderRadius: 16,
          padding: '32px 28px',
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255,255,255,0.05)',
          display: 'flex',
          flexDirection: 'column',
          gap: 22,
          position: 'relative',
          zIndex: 10,
        }}
      >
        {/* Header branding */}
        <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <div
            style={{
              width: 48, height: 48,
              borderRadius: 12,
              background: 'linear-gradient(135deg, #7c5bf5, #6248d8)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(124,91,245,0.4)',
              marginBottom: 12,
            }}
          >
            <Sparkles size={22} color="#fff" />
          </div>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#e4e7f4', letterSpacing: '-0.02em' }}>
            Flowkit by AWEMEDIA
          </h1>
          <p style={{ margin: 0, marginTop: 4, fontSize: 12, color: '#9298b8' }}>
            Hệ thống Quản lý Bản quyền Phần mềm
          </p>
        </div>

        {/* Cảnh báo trạng thái hết hạn / chưa kích hoạt */}
        {license?.error && (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              color: '#ef4444',
              fontSize: 11,
              lineHeight: 1.6,
              display: 'flex',
              gap: 8,
              alignItems: 'center',
            }}
          >
            <ShieldAlert size={14} style={{ flexShrink: 0 }} />
            <div>{license.error}</div>
          </div>
        )}

        {/* Panel lấy mã máy phần cứng */}
        <div
          style={{
            background: 'rgba(7, 8, 12, 0.5)',
            border: '1px solid rgba(255, 255, 255, 0.04)',
            borderRadius: 10,
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, color: '#555d80', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            <Cpu size={11} />
            Mã định danh thiết bị (Machine ID)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyItems: 'space-between', gap: 8 }}>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 11,
                color: '#7c5bf5',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                flex: 1,
                userSelect: 'all',
              }}
              title={license?.machineId}
            >
              {license?.machineId}
            </div>
            <button
              onClick={handleCopyMachineId}
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.06)',
                borderRadius: 6,
                padding: '4px 8px',
                cursor: 'pointer',
                color: '#9298b8',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 10,
                transition: 'all 0.2s',
              }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(124,91,245,0.3)')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)')}
            >
              {copied ? (
                <>
                  <Check size={11} color="var(--green)" />
                  <span style={{ color: 'var(--green)' }}>Đã sao chép</span>
                </>
              ) : (
                <>
                  <Clipboard size={11} />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Form nhập mã kích hoạt */}
        <form onSubmit={handleActivate} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ fontSize: 11, fontWeight: 700, color: '#9298b8' }}>
              Nhập mã kích hoạt (License Key)
            </label>
            <input
              type="text"
              placeholder="FK-XXXX-XXXX-XXXX-XXXX"
              value={activationKey}
              onChange={e => setActivationKey(e.target.value.toUpperCase())}
              disabled={activating}
              style={{
                background: 'rgba(7, 8, 12, 0.8)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 8,
                padding: '12px 14px',
                fontSize: 13,
                fontFamily: 'monospace',
                color: '#fff',
                textAlign: 'center',
                letterSpacing: '0.1em',
                width: '100%',
                outline: 'none',
                boxSizing: 'border-box',
                transition: 'border-color 0.2s',
              }}
              onFocus={e => (e.currentTarget.style.borderColor = '#7c5bf5')}
              onBlur={e => (e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.08)')}
            />
          </div>

          {/* Feedback Messages */}
          {errorMsg && (
            <div style={{ fontSize: 11, color: '#ef4444', textAlign: 'center' }}>
              ⚠ {errorMsg}
            </div>
          )}
          {successMsg && (
            <div style={{ fontSize: 11, color: 'var(--green)', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
              <Check size={12} />
              {successMsg}
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={activating || successMsg !== null}
            style={{
              padding: '12px',
              borderRadius: 8,
              background: 'linear-gradient(135deg, #7c5bf5, #6248d8)',
              color: '#fff',
              border: 'none',
              cursor: activating ? 'wait' : 'pointer',
              fontSize: 13,
              fontWeight: 700,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: activating || successMsg !== null ? 0.7 : 1,
              transition: 'transform 0.15s, opacity 0.2s',
            }}
            onMouseEnter={e => { if (!activating && !successMsg) e.currentTarget.style.transform = 'translateY(-1px)' }}
            onMouseLeave={e => (e.currentTarget.style.transform = 'translateY(0)')}
          >
            {activating ? (
              <>
                <RefreshCw size={14} style={{ animation: 'spin 1s linear infinite' }} />
                Đang kích hoạt...
              </>
            ) : (
              'Kích hoạt bản quyền'
            )}
          </button>
        </form>

        {/* Footer info */}
        <div style={{ textAlign: 'center', fontSize: 10, color: '#555d80', marginTop: 4, lineHeight: 1.6 }}>
          Mỗi bản quyền chỉ hoạt động trên một máy duy nhất tại một thời điểm.<br />
          Hỗ trợ kỹ thuật: <strong>support@awemedia.vn</strong>
        </div>
      </div>
    </div>
  )
}
