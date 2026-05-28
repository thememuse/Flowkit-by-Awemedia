/**
 * AIProviderPicker — dropdown chọn AI provider với badge số keys khả dụng.
 * Dùng trong AIProjectCreator, AIEpisodeCreator, AutoPipelineModal.
 */
import { useEffect, useState } from 'react'
import { fetchAPI } from '../../api/client'
import { Bot, Shuffle, Check } from 'lucide-react'

interface KeyStatus {
  total: number
  available: number
  rate_limited: number
}

interface KeyStatusMap {
  claude: KeyStatus
  openai: KeyStatus
  gemini: KeyStatus
}

interface Props {
  value: string                        // "claude" | "openai" | "gemini" | "auto"
  onChange: (v: string) => void
  label?: string
  compact?: boolean                    // smaller version for inline use
}

const PROVIDERS = [
  { id: 'auto',   label: 'Tự động', icon: <Shuffle size={13} />,                                                         desc: 'Dùng provider trong Cài đặt' },
  { id: 'claude', label: 'Claude',   icon: <span style={{ width:13,height:13,borderRadius:'50%',background:'#9333ea',display:'inline-block',flexShrink:0 }} />, desc: 'Anthropic Claude' },
  { id: 'openai', label: 'GPT',      icon: <span style={{ width:13,height:13,borderRadius:'50%',background:'#22c55e',display:'inline-block',flexShrink:0 }} />, desc: 'OpenAI GPT-4o' },
  { id: 'gemini', label: 'Gemini',   icon: <span style={{ width:13,height:13,borderRadius:'50%',background:'#3b82f6',display:'inline-block',flexShrink:0 }} />, desc: 'Google Gemini' },
]

const INPUT: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  padding: '6px 10px',
  fontSize: 12,
  outline: 'none',
  cursor: 'pointer',
  width: '100%',
}

export default function AIProviderPicker({ value, onChange, label, compact }: Props) {
  const [keyStatus, setKeyStatus] = useState<KeyStatusMap | null>(null)

  useEffect(() => {
    fetchAPI<KeyStatusMap>('/api/ai/key-status').then(setKeyStatus).catch(() => {})
  }, [])

  function badge(pid: string) {
    if (!keyStatus || pid === 'auto') return null
    const s = keyStatus[pid as keyof KeyStatusMap]
    if (!s) return null
    const color = s.available > 0 ? 'var(--green)' : s.total > 0 ? 'var(--yellow)' : 'var(--muted)'
    const txt   = s.total === 0 ? 'No key' : `${s.available}/${s.total}`
    return (
      <span
        className="ml-auto text-xs font-mono rounded px-1"
        style={{ background: `${color}22`, color, border: `1px solid ${color}44`, fontSize: 9 }}
      >
        {txt}
      </span>
    )
  }

  if (compact) {
    // Inline select + single badge
    const s = value !== 'auto' && keyStatus ? keyStatus[value as keyof KeyStatusMap] : null
    const statusColor = s ? (s.available > 0 ? 'var(--green)' : s.total > 0 ? 'var(--yellow)' : 'var(--muted)') : 'var(--muted)'

    return (
      <div className="flex items-center gap-1.5" style={{ minWidth: 0 }}>
        {label && (
          <Bot size={11} color="var(--muted)" />
        )}
        <select
          value={value}
          onChange={e => onChange(e.target.value)}
          style={{ ...INPUT, padding: '4px 6px', width: 'auto', fontSize: 11 }}
        >
          {PROVIDERS.map(p => {
            const ks = p.id !== 'auto' && keyStatus ? keyStatus[p.id as keyof KeyStatusMap] : null
            const avail = ks ? ks.available : null
            return (
              <option key={p.id} value={p.id}>
                {p.label}{avail !== null ? ` (${avail})` : ''}
              </option>
            )
          })}
        </select>
        {s && (
          <span className="text-xs" style={{ color: statusColor, fontSize: 10, whiteSpace: 'nowrap' }}>
            {s.available}/{s.total} keys
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--muted)' }}>
          <Bot size={11} />
          {label}
        </label>
      )}
      <div className="flex flex-col gap-1">
        {PROVIDERS.map(p => {
          const isSelected = value === p.id
          return (
            <button
              key={p.id}
              onClick={() => onChange(p.id)}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-all"
              style={{
                background: isSelected ? 'rgba(124,91,245,0.1)' : 'var(--card)',
                border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}
            >
              <span className="flex items-center justify-center" style={{ width: 18, height: 18, flexShrink: 0 }}>{p.icon}</span>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-xs font-semibold" style={{ color: isSelected ? 'var(--accent)' : 'var(--text)' }}>
                  {p.label}
                </span>
                <span className="text-xs" style={{ color: 'var(--muted)', fontSize: 10 }}>
                  {p.desc}
                </span>
              </div>
              {badge(p.id)}
              {isSelected && (
                <Check size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
