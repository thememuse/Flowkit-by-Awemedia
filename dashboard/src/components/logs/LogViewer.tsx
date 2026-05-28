import { useState, useEffect, useRef } from 'react'
import { useWebSocket } from '../../api/useWebSocket'

interface LogEntry {
  id: number
  timestamp: string
  type: 'ws_event' | 'python' | 'system'
  content: string
  level: 'info' | 'warn' | 'error' | 'debug'
}

let logIdCounter = 0

function detectLevel(content: string): LogEntry['level'] {
  const lower = content.toLowerCase()
  if (lower.includes('error') || lower.includes('exception') || lower.includes('failed')) return 'error'
  if (lower.includes('warning') || lower.includes('warn')) return 'warn'
  if (lower.includes('debug')) return 'debug'
  return 'info'
}

const LEVEL_COLORS: Record<LogEntry['level'], string> = {
  info: 'var(--text)',
  warn: 'var(--yellow)',
  error: 'var(--red)',
  debug: 'var(--muted)',
}

const LEVEL_BG: Record<LogEntry['level'], string> = {
  info: 'transparent',
  warn: 'rgba(245,158,11,0.05)',
  error: 'rgba(239,68,68,0.07)',
  debug: 'transparent',
}

export default function LogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info' | 'python'>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [maxLines, setMaxLines] = useState(500)
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { lastEvent } = useWebSocket()

  // Add system log entry
  const addLog = (content: string, type: LogEntry['type'] = 'ws_event') => {
    setLogs(prev => {
      const entry: LogEntry = {
        id: ++logIdCounter,
        timestamp: new Date().toISOString(),
        type,
        content,
        level: detectLevel(content),
      }
      const next = [...prev, entry]
      return next.slice(-maxLines) // keep last N entries
    })
  }

  // Listen to WebSocket events
  useEffect(() => {
    if (!lastEvent) return
    const content = JSON.stringify(lastEvent, null, 2)
    addLog(content, 'ws_event')
  }, [lastEvent])

  // Listen to Python logs (Electron only)
  useEffect(() => {
    const electronAPI = (window as unknown as { electronAPI?: {
      onPythonLog?: (cb: (line: string) => void) => () => void
    }}).electronAPI

    if (!electronAPI?.onPythonLog) return

    addLog('[Hệ thống] Đang lắng nghe log từ Python agent...', 'system')
    const unsub = electronAPI.onPythonLog((line) => {
      addLog(line, 'python')
    })

    return unsub
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, autoScroll])

  // Detect manual scroll up
  const handleScroll = () => {
    const el = containerRef.current
    if (!el) return
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50
    setAutoScroll(isAtBottom)
  }

  const filteredLogs = logs.filter(log => {
    if (filter === 'all') return true
    if (filter === 'python') return log.type === 'python'
    return log.level === filter
  })

  const formatTime = (iso: string) => {
    return new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
  }

  const filters: Array<{ key: typeof filter; label: string; count?: number }> = [
    { key: 'all', label: `Tất cả (${logs.length})` },
    { key: 'python', label: `Python (${logs.filter(l => l.type === 'python').length})` },
    { key: 'error', label: `Lỗi (${logs.filter(l => l.level === 'error').length})` },
    { key: 'warn', label: `Cảnh báo (${logs.filter(l => l.level === 'warn').length})` },
    { key: 'info', label: `Thông tin (${logs.filter(l => l.level === 'info').length})` },
  ]

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap flex-shrink-0">
        {/* Filter tabs */}
        <div className="flex gap-1">
          {filters.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className="px-2.5 py-1 rounded text-xs font-semibold transition-colors"
              style={{
                background: filter === f.key ? 'var(--accent)' : 'var(--card)',
                color: filter === f.key ? '#fff' : 'var(--muted)',
                border: '1px solid var(--border)',
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Auto-scroll toggle */}
        <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--muted)' }}>
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={e => setAutoScroll(e.target.checked)}
            style={{ accentColor: 'var(--accent)' }}
          />
          Tự cuộn
        </label>

        {/* Clear button */}
        <button
          onClick={() => setLogs([])}
          className="px-2.5 py-1 rounded text-xs font-semibold"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          Xóa
        </button>
      </div>

      {/* Log container */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto rounded-lg"
        style={{
          background: '#080810',
          border: '1px solid var(--border)',
          fontFamily: "'DM Mono', 'Fira Code', monospace",
          fontSize: 11,
        }}
      >
        {filteredLogs.length === 0 ? (
          <div
            className="flex items-center justify-center h-full"
            style={{ color: 'var(--muted)' }}
          >
            {logs.length === 0
              ? 'Chưa có log nào — sự kiện sẽ xuất hiện ở đây'
              : 'Không có log nào khớp bộ lọc'
            }
          </div>
        ) : (
          <div className="p-3">
            {filteredLogs.map(log => (
              <div
                key={log.id}
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '2px 6px',
                  borderRadius: 3,
                  background: LEVEL_BG[log.level],
                  marginBottom: 1,
                  lineHeight: 1.6,
                }}
              >
                {/* Timestamp */}
                <span style={{ color: '#334155', flexShrink: 0 }}>
                  {formatTime(log.timestamp)}
                </span>

                {/* Type badge */}
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: log.type === 'python' ? 'rgba(59,130,246,0.2)'
                      : log.type === 'system' ? 'rgba(100,116,139,0.2)'
                      : 'rgba(34,197,94,0.2)',
                    color: log.type === 'python' ? 'var(--accent)'
                      : log.type === 'system' ? 'var(--muted)'
                      : 'var(--green)',
                    alignSelf: 'flex-start',
                    marginTop: 2,
                    textTransform: 'uppercase',
                  }}
                >
                  {log.type === 'ws_event' ? 'ws' : log.type}
                </span>

                {/* Content */}
                <pre
                  style={{
                    color: LEVEL_COLORS[log.level],
                    margin: 0,
                    flex: 1,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-all',
                    fontFamily: 'inherit',
                    fontSize: 'inherit',
                  }}
                >
                  {log.content}
                </pre>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* Status bar */}
      <div
        className="flex items-center gap-4 text-xs flex-shrink-0"
        style={{ color: 'var(--muted)' }}
      >
        <span>{filteredLogs.length} / {logs.length} mục</span>
        <span>Tối đa: {maxLines} dòng</span>
        <select
          value={maxLines}
          onChange={e => setMaxLines(Number(e.target.value))}
          className="text-xs px-1 py-0.5 rounded"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          <option value={100}>100</option>
          <option value={500}>500</option>
          <option value={1000}>1000</option>
          <option value={5000}>5000</option>
        </select>
        {!autoScroll && (
          <button
            onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
            className="px-2 py-0.5 rounded"
            style={{ background: 'var(--accent)', color: '#fff', fontSize: 10 }}
          >
            Cuộn xuống ↓
          </button>
        )}
      </div>
    </div>
  )
}
