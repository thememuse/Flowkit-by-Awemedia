import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Mic, Plus, Trash2, Play, Square, Download, FileUp,
  ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle, Volume2,
  RefreshCw, Zap, Sliders, List, X, SkipForward, AudioWaveform,
  Settings, Globe, FileText, GripVertical
} from 'lucide-react'
import { fetchAPI, postAPI } from '../api/client'

// ── Types ──────────────────────────────────────────────────
interface VoiceSettings {
  stability: number
  similarity_boost: number
  style: number
  use_speaker_boost: boolean
  speed: number
}

interface ElevenLabsVoice {
  voice_id: string
  name: string
  category?: string
  labels?: Record<string, string>
  preview_url?: string
  description?: string
}

interface Segment {
  id: string
  text: string
  status: 'idle' | 'generating' | 'completed' | 'failed'
  audio_url?: string
  duration?: number
  character_count?: number
  error?: string
  speaker?: string
}

type ImportFormat = 'txt' | 'csv' | 'srt'

// ── Parse helpers ──────────────────────────────────────────
function parseTxt(text: string, splitMode: 'line' | 'sentence'): Segment[] {
  let parts: string[] = []
  if (splitMode === 'sentence') {
    parts = text.split(/(?<=[.!?。！？])\s+/).map(s => s.trim()).filter(Boolean)
  } else {
    parts = text.split('\n').map(l => l.trim()).filter(Boolean)
  }
  return parts.map(text => ({ id: crypto.randomUUID(), text, status: 'idle' as const }))
}

function parseCsv(text: string): Segment[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const segments: Segment[] = []
  for (const line of lines) {
    const cols = line.match(/("(?:[^"\\]|\\.)*"|[^,]+)/g)?.map(c =>
      c.trim().replace(/^"|"$/g, '').replace(/""/g, '"')
    ) || [line]
    if (cols.length >= 2) {
      const speaker = cols[0].trim()
      const text = cols[1].trim()
      if (['speaker', 'name', 'voice', 'text', 'content', 'prompt'].includes(speaker.toLowerCase())) continue
      if (text && !['text', 'content', 'prompt', 'description'].includes(text.toLowerCase())) {
        segments.push({ id: crypto.randomUUID(), text, status: 'idle', speaker })
      }
    } else if (cols[0]) {
      const text = cols[0].trim()
      if (!['text', 'content', 'speaker', 'prompt'].includes(text.toLowerCase())) {
        segments.push({ id: crypto.randomUUID(), text, status: 'idle' })
      }
    }
  }
  return segments
}

function parseSrt(text: string): Segment[] {
  const segments: Segment[] = []
  const blocks = text.split(/\n\s*\n/).filter(b => b.trim())
  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 3) continue
    if (!/^\d+$/.test(lines[0])) continue
    if (!lines[1].includes('-->')) continue
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim()
    if (text) segments.push({ id: crypto.randomUUID(), text, status: 'idle' })
  }
  return segments
}

// ── Constants ──────────────────────────────────────────────
const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stability: 0.5, similarity_boost: 0.75, style: 0.0, use_speaker_boost: true, speed: 1.0,
}

const MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2', badge: 'Khuyên dùng', desc: 'Chất lượng cao, 29 ngôn ngữ, 40k ký tự/lần' },
  { id: 'eleven_v3',              label: 'Eleven v3',        badge: 'Flagship',    desc: 'Cảm xúc phong phú, 70+ ngôn ngữ, giới hạn 5k ký tự' },
  { id: 'eleven_flash_v2_5',      label: 'Flash v2.5',       badge: '⚡ Nhanh',   desc: 'Độ trễ ~75ms, 32 ngôn ngữ' },
  { id: 'eleven_turbo_v2_5',      label: 'Turbo v2.5',       badge: null,          desc: 'Cân bằng chất lượng / tốc độ, 32 ngôn ngữ' },
]

const OUTPUT_FORMATS = [
  { value: 'mp3_44100_128', label: 'MP3 44.1kHz · 128kbps', group: 'MP3' },
  { value: 'mp3_44100_192', label: 'MP3 44.1kHz · 192kbps (Creator+)', group: 'MP3' },
  { value: 'mp3_44100_96',  label: 'MP3 44.1kHz · 96kbps', group: 'MP3' },
  { value: 'mp3_44100_64',  label: 'MP3 44.1kHz · 64kbps', group: 'MP3' },
  { value: 'mp3_22050_32',  label: 'MP3 22kHz · 32kbps (nhỏ nhất)', group: 'MP3' },
  { value: 'pcm_44100',     label: 'PCM 44.1kHz (không nén)', group: 'PCM' },
  { value: 'pcm_24000',     label: 'PCM 24kHz', group: 'PCM' },
  { value: 'pcm_16000',     label: 'PCM 16kHz', group: 'PCM' },
]

// ── Collapsible Section ────────────────────────────────────
function CollapsibleSection({
  title, icon, defaultOpen = true, badge, children
}: {
  title: string, icon: React.ReactNode, defaultOpen?: boolean,
  badge?: string, children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text)' }}>{title}</span>
          {badge && (
            <span className="px-1.5 py-0.5 rounded text-[9px] font-bold"
              style={{ background: 'var(--accent)22', color: 'var(--accent)' }}>{badge}</span>
          )}
        </div>
        {open
          ? <ChevronUp size={13} style={{ color: 'var(--muted)' }} />
          : <ChevronDown size={13} style={{ color: 'var(--muted)' }} />
        }
      </button>
      {open && (
        <div className="px-4 pb-4 flex flex-col gap-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div style={{ height: 4 }} />
          {children}
        </div>
      )}
    </div>
  )
}

// ── Slider ─────────────────────────────────────────────────
function Slider({
  label, value, min, max, step, onChange, hint, fmt
}: {
  label: string, value: number, min: number, max: number, step: number,
  onChange: (v: number) => void, hint?: string, fmt?: (v: number) => string
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>{label}</span>
        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded tabular-nums"
          style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>
          {fmt ? fmt(value) : value.toFixed(2)}
        </span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: 'var(--accent)' }}
      />
      {hint && <p className="text-[10px] leading-snug" style={{ color: 'var(--muted)' }}>{hint}</p>}
    </div>
  )
}

// ── Import Modal ───────────────────────────────────────────
function ImportModal({ onClose, onImport }: { onClose: () => void; onImport: (segs: Segment[]) => void }) {
  const [tab, setTab] = useState<ImportFormat>('txt')
  const [text, setText] = useState('')
  const [splitMode, setSplitMode] = useState<'line' | 'sentence'>('line')
  const [preview, setPreview] = useState<Segment[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const processText = useCallback((raw: string, format: ImportFormat) => {
    let segs: Segment[] = []
    if (format === 'txt') segs = parseTxt(raw, splitMode)
    else if (format === 'csv') segs = parseCsv(raw)
    else if (format === 'srt') segs = parseSrt(raw)
    setPreview(segs)
  }, [splitMode])

  useEffect(() => {
    if (text) processText(text, tab)
    else setPreview([])
  }, [text, tab, splitMode, processText])

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const raw = ev.target?.result as string
      setText(raw)
      const ext = file.name.split('.').pop()?.toLowerCase()
      if (ext === 'srt') setTab('srt')
      else if (ext === 'csv') setTab('csv')
      else setTab('txt')
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }} onClick={onClose}>
      <div
        className="flex flex-col gap-4 p-5 rounded-2xl shadow-2xl"
        style={{ width: 580, maxHeight: '85vh', background: 'var(--card)', border: '1px solid var(--border)', overflowY: 'auto' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <FileText size={15} style={{ color: 'var(--accent)' }} /> Import văn bản
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--muted)' }}>TXT · CSV · SRT — mỗi đoạn → 1 segment</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.06)]">
            <X size={15} style={{ color: 'var(--muted)' }} />
          </button>
        </div>

        {/* Format tabs */}
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--surface)' }}>
          {(['txt', 'csv', 'srt'] as ImportFormat[]).map(f => (
            <button key={f} onClick={() => setTab(f)}
              className="flex-1 py-1.5 rounded-md text-[11px] font-bold uppercase transition-all"
              style={{ background: tab === f ? 'var(--accent)' : 'transparent', color: tab === f ? '#fff' : 'var(--muted)' }}>
              .{f}
            </button>
          ))}
        </div>

        {/* Hint */}
        <div className="text-[11px] px-3 py-2 rounded-lg" style={{ background: 'rgba(124,91,245,0.07)', color: 'var(--muted)', border: '1px solid rgba(124,91,245,0.12)' }}>
          {tab === 'txt' && 'Mỗi dòng = 1 segment (theo dòng) hoặc tách theo dấu câu .!? (theo câu)'}
          {tab === 'csv' && 'Cột 1 = Người nói, Cột 2 = Nội dung. Bỏ qua dòng header. VD: "Nam","Xin chào!"'}
          {tab === 'srt' && 'Phụ đề SRT chuẩn — tự loại bỏ số thứ tự và timecode, giữ lại text.'}
        </div>

        {/* TXT split mode */}
        {tab === 'txt' && (
          <div className="flex gap-2">
            {(['line', 'sentence'] as const).map(m => (
              <button key={m} onClick={() => setSplitMode(m)}
                className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold border transition-all"
                style={{
                  background: splitMode === m ? 'rgba(124,91,245,0.1)' : 'var(--surface)',
                  color: splitMode === m ? 'var(--accent)' : 'var(--muted)',
                  borderColor: splitMode === m ? 'rgba(124,91,245,0.3)' : 'var(--border)',
                }}>
                {m === 'line' ? '↩ Theo dòng' : '• Theo câu (.!?)'}
              </button>
            ))}
          </div>
        )}

        {/* Upload */}
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".txt,.csv,.srt" className="hidden" onChange={handleFile} />
          <button onClick={() => fileRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border hover:bg-[rgba(255,255,255,0.04)]"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            <FileUp size={12} /> Chọn file .{tab}
          </button>
          <span className="text-[11px]" style={{ color: 'var(--muted)' }}>hoặc dán text bên dưới</span>
        </div>

        {/* Textarea */}
        <textarea rows={5} value={text} onChange={e => setText(e.target.value)}
          placeholder={
            tab === 'txt' ? 'Dán văn bản...\nMỗi dòng = 1 segment' :
            tab === 'csv' ? 'Nam,"Xin chào!"\nNữ,"Hôm nay đẹp nhỉ?"' :
            '1\n00:00:01,000 --> 00:00:03,000\nXin chào!'
          }
          className="w-full text-[11px] p-2.5 rounded-lg outline-none resize-none border font-mono"
          style={{ background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' }}
        />

        {/* Preview */}
        {preview.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <div className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>
              Xem trước — <span style={{ color: 'var(--accent)' }}>{preview.length} segment</span>
            </div>
            <div className="flex flex-col gap-1 overflow-y-auto" style={{ maxHeight: 130 }}>
              {preview.slice(0, 15).map((s, i) => (
                <div key={s.id} className="flex items-start gap-2 px-2 py-1.5 rounded-lg text-[11px]"
                  style={{ background: 'var(--surface)' }}>
                  <span className="font-bold flex-shrink-0 w-5 text-center" style={{ color: 'var(--accent)' }}>{i + 1}</span>
                  {s.speaker && <span className="px-1.5 rounded text-[9px] font-bold flex-shrink-0"
                    style={{ background: 'rgba(124,91,245,0.12)', color: 'var(--accent)' }}>{s.speaker}</span>}
                  <span style={{ color: 'var(--text)' }} className="truncate">{s.text}</span>
                </div>
              ))}
              {preview.length > 15 && (
                <div className="text-[11px] text-center py-0.5" style={{ color: 'var(--muted)' }}>
                  +{preview.length - 15} segment nữa
                </div>
              )}
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>Hủy</button>
          <button onClick={() => { onImport(preview); onClose() }}
            disabled={preview.length === 0}
            className="px-4 py-1.5 rounded-lg text-[11px] font-bold text-white"
            style={{ background: preview.length > 0 ? 'var(--accent)' : 'var(--surface)', opacity: preview.length === 0 ? 0.4 : 1 }}>
            Import {preview.length > 0 ? `${preview.length} segment` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Segment Card ───────────────────────────────────────────
function SegmentCard({
  seg, index, onTextChange, onDelete, onGenerate, onPlay, isPlaying, currentPlayingId
}: {
  seg: Segment; index: number
  onTextChange: (id: string, t: string) => void
  onDelete: (id: string) => void
  onGenerate: (seg: Segment) => void
  onPlay: (seg: Segment) => void
  isPlaying: boolean; currentPlayingId: string | null
}) {
  const active = currentPlayingId === seg.id && isPlaying
  const borderColor =
    seg.status === 'failed'    ? 'rgba(239,68,68,0.3)' :
    seg.status === 'completed' ? 'rgba(34,197,94,0.2)' :
    seg.status === 'generating'? 'rgba(124,91,245,0.3)' : 'var(--border)'

  return (
    <div className="rounded-xl p-3 flex flex-col gap-2 transition-all"
      style={{ background: 'var(--card)', border: `1px solid ${borderColor}` }}>

      {/* Row 1: meta + trash */}
      <div className="flex items-center gap-2">
        <GripVertical size={12} style={{ color: 'var(--border)', cursor: 'grab', flexShrink: 0 }} />
        <span className="text-[10px] font-bold w-5 h-5 rounded flex items-center justify-center flex-shrink-0"
          style={{ background: 'var(--accent)18', color: 'var(--accent)' }}>{index + 1}</span>

        {seg.speaker && (
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold flex-shrink-0"
            style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--yellow)' }}>{seg.speaker}</span>
        )}

        {/* Status */}
        <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-0.5"
          style={{
            background:
              seg.status === 'completed' ? 'rgba(34,197,94,0.1)' :
              seg.status === 'failed'    ? 'rgba(239,68,68,0.1)' :
              seg.status === 'generating'? 'rgba(124,91,245,0.1)' : 'var(--surface)',
            color:
              seg.status === 'completed' ? 'var(--green)' :
              seg.status === 'failed'    ? 'var(--red)' :
              seg.status === 'generating'? 'var(--accent)' : 'var(--muted)',
          }}>
          {seg.status === 'completed'  && <><CheckCircle2 size={9} /> Xong</>}
          {seg.status === 'failed'     && <><XCircle size={9} /> Lỗi</>}
          {seg.status === 'generating' && <><Loader2 size={9} className="spin" /> Tạo...</>}
          {seg.status === 'idle'       && 'Chờ'}
        </span>

        {seg.duration && (
          <span className="text-[9px] font-mono" style={{ color: 'var(--muted)' }}>{seg.duration.toFixed(1)}s</span>
        )}

        <button onClick={() => onDelete(seg.id)} className="ml-auto p-1 rounded hover:bg-[rgba(239,68,68,0.08)]">
          <Trash2 size={11} style={{ color: 'var(--muted)' }} />
        </button>
      </div>

      {/* Text */}
      <textarea rows={2} value={seg.text} onChange={e => onTextChange(seg.id, e.target.value)}
        placeholder="Nhập nội dung thoại..."
        className="w-full text-[11px] px-2 py-1.5 rounded-lg outline-none resize-none border"
        style={{ background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)', lineHeight: 1.5 }}
      />

      {/* Error */}
      {seg.status === 'failed' && seg.error && (
        <div className="text-[10px] px-2 py-1 rounded" style={{ background: 'rgba(239,68,68,0.07)', color: 'var(--red)' }}>
          {seg.error}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-1.5 justify-between">
        <div className="flex items-center gap-1">
          {seg.audio_url && (
            <button onClick={() => onPlay(seg)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border transition-all"
              style={{
                background: active ? 'rgba(34,197,94,0.12)' : 'var(--surface)',
                color:      active ? 'var(--green)' : 'var(--muted)',
                borderColor:active ? 'rgba(34,197,94,0.3)' : 'var(--border)',
              }}>
              {active ? <><Square size={9} /> Dừng</> : <><Play size={9} fill="currentColor" /> Nghe</>}
            </button>
          )}
          {seg.audio_url && (
            <a href={`http://127.0.0.1:8100${seg.audio_url}`} download
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border hover:bg-[rgba(255,255,255,0.04)]"
              style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
              <Download size={9} /> Tải
            </a>
          )}
        </div>
        <button onClick={() => onGenerate(seg)}
          disabled={seg.status === 'generating' || !seg.text.trim()}
          className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold text-white transition-all"
          style={{
            background: seg.status === 'completed' ? 'rgba(124,91,245,0.75)' : 'var(--accent)',
            opacity: (seg.status === 'generating' || !seg.text.trim()) ? 0.4 : 1,
          }}>
          {seg.status === 'generating' ? <><Loader2 size={9} className="spin" /> Tạo...</>
           : seg.status === 'completed' ? <><RefreshCw size={9} /> Lại</>
           : <><Zap size={9} /> Tạo</>}
        </button>
      </div>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────
export default function TTSStudioPage() {
  // --- Config state ---
  const [voices, setVoices]           = useState<ElevenLabsVoice[]>([])
  const [loadingVoices, setLoadingVoices] = useState(false)
  const [voiceSearch, setVoiceSearch] = useState('')
  const [selectedVoice, setSelectedVoice] = useState<ElevenLabsVoice | null>(null)
  const [selectedModel, setSelectedModel] = useState('eleven_multilingual_v2')
  const [outputFormat, setOutputFormat] = useState('mp3_44100_128')
  const [voiceSettings, setVoiceSettings] = useState<VoiceSettings>(DEFAULT_VOICE_SETTINGS)
  const [apiKeyMissing, setApiKeyMissing] = useState(false)

  // --- Segments ---
  const [segments, setSegments] = useState<Segment[]>([{ id: crypto.randomUUID(), text: '', status: 'idle' }])
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchJobId, setBatchJobId]     = useState<string | null>(null)

  // --- UI state ---
  const [showImport, setShowImport] = useState(false)
  const [currentPlayingId, setCurrentPlayingId] = useState<string | null>(null)
  const [isPlaying, setIsPlaying]   = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pollRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Load settings defaults + voices ──
  useEffect(() => {
    fetchAPI<Record<string, unknown>>('/api/settings').then(s => {
      if (s.ttsDefaultModel)  setSelectedModel(String(s.ttsDefaultModel))
      if (s.ttsDefaultFormat) setOutputFormat(String(s.ttsDefaultFormat))
      if (s.ttsDefaultVoiceId) {
        // will select after voices load
        sessionStorage.setItem('_tts_default_voice_id', String(s.ttsDefaultVoiceId))
      }
      if (s.ttsStability !== undefined)      setVoiceSettings(p => ({ ...p, stability: Number(s.ttsStability) }))
      if (s.ttsSimilarityBoost !== undefined) setVoiceSettings(p => ({ ...p, similarity_boost: Number(s.ttsSimilarityBoost) }))
      if (s.ttsStyle !== undefined)           setVoiceSettings(p => ({ ...p, style: Number(s.ttsStyle) }))
      if (s.ttsSpeed !== undefined)           setVoiceSettings(p => ({ ...p, speed: Number(s.ttsSpeed) }))
    }).catch(() => {})
  }, [])

  const loadVoices = useCallback(async () => {
    setLoadingVoices(true)
    setApiKeyMissing(false)
    try {
      const data = await fetchAPI<{ voices: ElevenLabsVoice[]; total: number; configured?: boolean }>('/api/elevenlabs/voices')
      if (data.configured === false) {
        setApiKeyMissing(true)
        setVoices([])
        return
      }
      const vs = data.voices || []
      setVoices(vs)
      if (vs.length > 0) {
        const defaultId = sessionStorage.getItem('_tts_default_voice_id')
        const target = defaultId ? vs.find(v => v.voice_id === defaultId) : null
        if (!selectedVoice) setSelectedVoice(target || vs[0])
      }
    } catch (err: unknown) {
      const e = err as { status?: number; message?: string }
      if (e?.status === 400 || String(e?.message || '').includes('API key')) setApiKeyMissing(true)
    } finally {
      setLoadingVoices(false)
    }
  }, [selectedVoice])

  useEffect(() => { loadVoices() }, [])

  // ── Audio player ──
  function playAudio(seg: Segment) {
    if (!seg.audio_url) return
    if (currentPlayingId === seg.id && isPlaying) {
      audioRef.current?.pause()
      setIsPlaying(false); setCurrentPlayingId(null); return
    }
    audioRef.current?.pause()
    const a = new Audio(`http://127.0.0.1:8100${seg.audio_url}`)
    audioRef.current = a
    a.play()
    setCurrentPlayingId(seg.id); setIsPlaying(true)
    a.onended = () => { setIsPlaying(false); setCurrentPlayingId(null) }
  }

  // ── Generate single ──
  async function generateSegment(seg: Segment) {
    if (!selectedVoice || !seg.text.trim()) return
    setSegments(p => p.map(s => s.id === seg.id ? { ...s, status: 'generating', error: undefined } : s))
    const idx = segments.findIndex(s => s.id === seg.id)
    try {
      const r = await postAPI<{ ok: boolean; audio_url: string; duration?: number; character_count?: number; error?: string }>(
        '/api/elevenlabs/tts', {
          voice_id:      selectedVoice.voice_id,
          text:          seg.text,
          segment_id:    seg.id,
          model_id:      selectedModel,
          voice_settings: voiceSettings,
          output_format: outputFormat,
          previous_text: idx > 0 ? segments[idx - 1].text : undefined,
          next_text:     idx < segments.length - 1 ? segments[idx + 1].text : undefined,
        })
      if (r.ok) {
        setSegments(p => p.map(s => s.id === seg.id
          ? { ...s, status: 'completed', audio_url: r.audio_url, duration: r.duration, character_count: r.character_count }
          : s))
      } else {
        setSegments(p => p.map(s => s.id === seg.id ? { ...s, status: 'failed', error: r.error } : s))
      }
    } catch (e: unknown) {
      const err = e as { message?: string }
      setSegments(p => p.map(s => s.id === seg.id ? { ...s, status: 'failed', error: err?.message || 'Lỗi' } : s))
    }
  }

  // ── Batch generate ──
  async function generateAll() {
    if (!selectedVoice || batchRunning) return
    const pending = segments.filter(s => s.status !== 'completed' && s.text.trim())
    if (pending.length === 0) return
    setBatchRunning(true)
    try {
      const batchSegs = pending.map(seg => {
        const i = segments.findIndex(s => s.id === seg.id)
        return { id: seg.id, text: seg.text,
          previous_text: i > 0 ? segments[i - 1].text : undefined,
          next_text:     i < segments.length - 1 ? segments[i + 1].text : undefined }
      })
      const r = await postAPI<{ job_id: string }>('/api/elevenlabs/tts/batch', {
        voice_id:      selectedVoice.voice_id,
        segments:      batchSegs,
        model_id:      selectedModel,
        voice_settings: voiceSettings,
        output_format: outputFormat,
      })
      setBatchJobId(r.job_id)
      setSegments(p => p.map(s => pending.find(q => q.id === s.id) ? { ...s, status: 'generating' } : s))
      startPolling(r.job_id, pending.map(s => s.id))
    } catch { setBatchRunning(false) }
  }

  function startPolling(jobId: string, ids: string[]) {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const st = await fetchAPI<{ done: boolean; results: Array<{ segment_id: string; status: string; audio_url?: string; duration?: number; error?: string }> }>(
          `/api/elevenlabs/tts/batch/${jobId}`)
        for (const r of st.results) {
          if (!ids.includes(r.segment_id)) continue
          setSegments(p => p.map(s => s.id === r.segment_id ? {
            ...s,
            status:    r.status === 'completed' ? 'completed' : r.status === 'failed' ? 'failed' : 'generating',
            audio_url: r.audio_url,
            duration:  r.duration,
            error:     r.error,
          } : s))
        }
        if (st.done) { clearInterval(pollRef.current!); pollRef.current = null; setBatchRunning(false); setBatchJobId(null) }
      } catch { clearInterval(pollRef.current!); pollRef.current = null; setBatchRunning(false) }
    }, 2000)
  }

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); audioRef.current?.pause() }, [])

  async function cancelBatch() {
    if (!batchJobId) return
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    try { await fetchAPI(`/api/elevenlabs/tts/batch/${batchJobId}`) } catch (_) {}
    setBatchRunning(false); setBatchJobId(null)
    setSegments(p => p.map(s => s.status === 'generating' ? { ...s, status: 'idle' } : s))
  }

  // ── Segment helpers ──
  const addSegment    = () => setSegments(p => [...p, { id: crypto.randomUUID(), text: '', status: 'idle' }])
  const deleteSegment = (id: string) => setSegments(p => p.filter(s => s.id !== id))
  const updateText    = (id: string, text: string) => setSegments(p => p.map(s => s.id === id ? { ...s, text } : s))
  const importSegs    = (segs: Segment[]) => setSegments(p => [...p.filter(s => s.text.trim()), ...segs])

  // ── Stats ──
  const total     = segments.length
  const completed = segments.filter(s => s.status === 'completed').length
  const failed    = segments.filter(s => s.status === 'failed').length
  const pending   = segments.filter(s => s.status === 'idle' && s.text.trim()).length
  const totalDur  = segments.reduce((a, s) => a + (s.duration || 0), 0)
  const totalChars= segments.reduce((a, s) => a + s.text.length, 0)

  const filteredVoices = voices.filter(v =>
    v.name.toLowerCase().includes(voiceSearch.toLowerCase()) ||
    v.labels?.gender?.toLowerCase().includes(voiceSearch.toLowerCase()) ||
    v.labels?.accent?.toLowerCase().includes(voiceSearch.toLowerCase()) ||
    v.category?.toLowerCase().includes(voiceSearch.toLowerCase())
  )

  function downloadAll() {
    segments.filter(s => s.status === 'completed' && s.audio_url).forEach((s, i) => {
      setTimeout(() => {
        const a = document.createElement('a')
        a.href = `http://127.0.0.1:8100${s.audio_url}`
        a.download = `segment_${String(i + 1).padStart(3, '0')}.mp3`
        a.click()
      }, i * 350)
    })
  }

  // ── Render ──
  return (
    <div className="flex flex-col gap-4 h-full">
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImport={importSegs} />}

      {/* ── Header ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold tracking-tight flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <AudioWaveform size={20} style={{ color: 'var(--accent)' }} />
            TTS Studio
            <span className="text-[10px] font-normal px-2 py-0.5 rounded-full" style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>
              ElevenLabs
            </span>
          </h1>
          <p className="text-[11px] mt-0.5 flex items-center gap-2" style={{ color: 'var(--muted)' }}>
            <span>{total} segment</span>
            <span>·</span>
            <span>{totalChars.toLocaleString()} ký tự</span>
            {totalDur > 0 && <>
              <span>·</span>
              <span>{Math.floor(totalDur / 60)}:{String(Math.round(totalDur % 60)).padStart(2, '0')} phút</span>
            </>}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {completed > 0 && (
            <button onClick={downloadAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border"
              style={{ borderColor: 'rgba(34,197,94,0.3)', color: 'var(--green)', background: 'rgba(34,197,94,0.06)' }}>
              <Download size={12} /> Tải tất cả ({completed})
            </button>
          )}
          <button onClick={() => setShowImport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border hover:bg-[rgba(255,255,255,0.04)]"
            style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
            <FileUp size={12} /> Import TXT/CSV/SRT
          </button>
        </div>
      </div>

      {/* API key warning */}
      {apiKeyMissing && (
        <div className="px-3 py-2 rounded-xl flex items-center gap-2 text-[11px]"
          style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)', color: 'var(--yellow)' }}>
          <XCircle size={14} />
          Chưa có ElevenLabs API Key — vào <strong className="ml-1">Cài đặt → API Keys</strong>
        </div>
      )}

      {/* ── Main layout ── */}
      <div className="grid gap-4 flex-1" style={{ gridTemplateColumns: '300px 1fr', alignItems: 'start' }}>

        {/* ── LEFT PANEL ── */}
        <div className="flex flex-col gap-3 sticky top-0">

          {/* 1. Giọng đọc — always open, most important */}
          <CollapsibleSection
            title="Giọng đọc"
            icon={<Mic size={13} style={{ color: 'var(--accent)' }} />}
            defaultOpen={true}
            badge={selectedVoice ? selectedVoice.name : undefined}
          >
            {/* Load button */}
            <div className="flex items-center gap-2">
              <input type="text" placeholder="Tìm giọng..." value={voiceSearch}
                onChange={e => setVoiceSearch(e.target.value)}
                className="flex-1 text-[11px] px-2 py-1.5 rounded-lg outline-none border"
                style={{ background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' }}
              />
              <button onClick={loadVoices}
                className="p-1.5 rounded-lg border hover:bg-[rgba(255,255,255,0.04)]"
                style={{ borderColor: 'var(--border)' }}>
                {loadingVoices
                  ? <Loader2 size={12} className="spin" style={{ color: 'var(--muted)' }} />
                  : <RefreshCw size={12} style={{ color: 'var(--muted)' }} />}
              </button>
            </div>

            {voices.length === 0 && !loadingVoices && (
              <div className="text-[11px] text-center py-3" style={{ color: 'var(--muted)' }}>
                {apiKeyMissing ? 'Cần API Key để tải danh sách giọng' : 'Nhấn ↺ để tải danh sách giọng'}
              </div>
            )}

            {/* Selected voice pill */}
            {selectedVoice && (
              <div className="flex items-center gap-2 p-2 rounded-lg"
                style={{ background: 'rgba(124,91,245,0.08)', border: '1px solid rgba(124,91,245,0.18)' }}>
                <div className="w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs flex-shrink-0"
                  style={{ background: 'var(--accent)', color: '#fff' }}>
                  {selectedVoice.name[0]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] font-semibold truncate" style={{ color: 'var(--text)' }}>{selectedVoice.name}</div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--muted)' }}>
                    {[selectedVoice.labels?.gender, selectedVoice.labels?.accent].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {selectedVoice.preview_url && (
                  <button onClick={() => new Audio(selectedVoice.preview_url!).play()}
                    className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: 'var(--accent)', color: '#fff' }} title="Nghe thử">
                    <Volume2 size={10} />
                  </button>
                )}
              </div>
            )}

            {/* Voice list */}
            {filteredVoices.length > 0 && (
              <div className="flex flex-col gap-0.5 overflow-y-auto" style={{ maxHeight: 180 }}>
                {filteredVoices.map(v => (
                  <button key={v.voice_id} onClick={() => setSelectedVoice(v)}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all w-full"
                    style={{
                      background: selectedVoice?.voice_id === v.voice_id ? 'rgba(124,91,245,0.1)' : 'transparent',
                      color:      selectedVoice?.voice_id === v.voice_id ? 'var(--accent)' : 'var(--text)',
                    }}>
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
                      style={{
                        background: selectedVoice?.voice_id === v.voice_id ? 'var(--accent)' : 'var(--surface)',
                        color:      selectedVoice?.voice_id === v.voice_id ? '#fff' : 'var(--muted)',
                      }}>{v.name[0]}</span>
                    <span className="text-[11px] font-medium truncate flex-1">{v.name}</span>
                    {v.labels?.gender && <span className="text-[9px] flex-shrink-0" style={{ color: 'var(--muted)' }}>{v.labels.gender}</span>}
                  </button>
                ))}
              </div>
            )}
          </CollapsibleSection>

          {/* 2. Model — collapsible, medium priority */}
          <CollapsibleSection
            title="Model"
            icon={<Zap size={13} style={{ color: 'var(--accent)' }} />}
            defaultOpen={false}
            badge={MODELS.find(m => m.id === selectedModel)?.label}
          >
            <div className="flex flex-col gap-1">
              {MODELS.map(m => (
                <button key={m.id} onClick={() => setSelectedModel(m.id)}
                  className="flex items-start gap-2.5 px-3 py-2 rounded-lg text-left border transition-all w-full"
                  style={{
                    background:  selectedModel === m.id ? 'rgba(124,91,245,0.08)' : 'transparent',
                    borderColor: selectedModel === m.id ? 'rgba(124,91,245,0.25)' : 'var(--border)',
                  }}>
                  <div className="w-3.5 h-3.5 rounded-full border-2 flex-shrink-0 mt-0.5 transition-all"
                    style={{
                      borderColor: selectedModel === m.id ? 'var(--accent)' : 'var(--border)',
                      background:  selectedModel === m.id ? 'var(--accent)' : 'transparent',
                    }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] font-semibold" style={{ color: selectedModel === m.id ? 'var(--accent)' : 'var(--text)' }}>
                        {m.label}
                      </span>
                      {m.badge && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold"
                          style={{ background: 'var(--accent)15', color: 'var(--accent)' }}>{m.badge}</span>
                      )}
                    </div>
                    <div className="text-[10px] mt-0.5 leading-snug" style={{ color: 'var(--muted)' }}>{m.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </CollapsibleSection>

          {/* 3. Voice Settings — collapsible, less frequent */}
          <CollapsibleSection
            title="Điều chỉnh giọng"
            icon={<Sliders size={13} style={{ color: 'var(--accent)' }} />}
            defaultOpen={false}
            badge={voiceSettings.speed !== 1.0 ? `${voiceSettings.speed.toFixed(1)}×` : undefined}
          >
            <Slider label="Stability" value={voiceSettings.stability}
              min={0} max={1} step={0.01} onChange={v => setVoiceSettings(p => ({ ...p, stability: v }))}
              hint="Thấp = đa cảm xúc · Cao = ổn định" />
            <Slider label="Similarity Boost" value={voiceSettings.similarity_boost}
              min={0} max={1} step={0.01} onChange={v => setVoiceSettings(p => ({ ...p, similarity_boost: v }))}
              hint="Cao = sát giọng gốc (có thể khuếch đại nhiễu)" />
            <Slider label="Style" value={voiceSettings.style}
              min={0} max={1} step={0.01} onChange={v => setVoiceSettings(p => ({ ...p, style: v }))}
              hint="Phong cách nói — chỉ hiệu quả với v2/v3" />
            <Slider label="Tốc độ" value={voiceSettings.speed}
              min={0.25} max={4.0} step={0.05}
              onChange={v => setVoiceSettings(p => ({ ...p, speed: v }))}
              fmt={v => `${v.toFixed(2)}×`}
              hint="1.0 = bình thường · 0.25×–4.0×" />

            {/* Speaker Boost toggle */}
            <div className="flex items-center justify-between pt-1" style={{ borderTop: '1px solid var(--border)' }}>
              <div>
                <div className="text-[11px] font-semibold" style={{ color: 'var(--text)' }}>Speaker Boost</div>
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>Tăng độ rõ và tương đồng</div>
              </div>
              <button
                onClick={() => setVoiceSettings(p => ({ ...p, use_speaker_boost: !p.use_speaker_boost }))}
                className="w-9 h-5 rounded-full transition-all relative flex-shrink-0"
                style={{ background: voiceSettings.use_speaker_boost ? 'var(--accent)' : 'var(--surface)', border: '1px solid var(--border)' }}>
                <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all"
                  style={{ left: voiceSettings.use_speaker_boost ? '1.1rem' : '2px' }} />
              </button>
            </div>

            <button onClick={() => setVoiceSettings(DEFAULT_VOICE_SETTINGS)}
              className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded border hover:bg-[rgba(255,255,255,0.04)]"
              style={{ color: 'var(--muted)', borderColor: 'var(--border)' }}>
              <RefreshCw size={9} /> Đặt lại mặc định
            </button>
          </CollapsibleSection>

          {/* 4. Output Format — collapsible, rarely changed */}
          <CollapsibleSection
            title="Định dạng xuất"
            icon={<Settings size={13} style={{ color: 'var(--accent)' }} />}
            defaultOpen={false}
            badge={outputFormat.split('_').slice(0, 2).join(' ')}
          >
            <div className="flex flex-col gap-1">
              {['MP3', 'PCM'].map(grp => (
                <div key={grp}>
                  <div className="text-[9px] font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--muted)' }}>{grp}</div>
                  {OUTPUT_FORMATS.filter(f => f.group === grp).map(f => (
                    <button key={f.value} onClick={() => setOutputFormat(f.value)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-all border mb-1"
                      style={{
                        background:  outputFormat === f.value ? 'rgba(124,91,245,0.08)' : 'transparent',
                        borderColor: outputFormat === f.value ? 'rgba(124,91,245,0.25)' : 'transparent',
                        color: outputFormat === f.value ? 'var(--accent)' : 'var(--text)',
                      }}>
                      <div className="w-2.5 h-2.5 rounded-full border flex-shrink-0"
                        style={{
                          borderColor: outputFormat === f.value ? 'var(--accent)' : 'var(--border)',
                          background:  outputFormat === f.value ? 'var(--accent)' : 'transparent',
                        }} />
                      <span className="text-[11px]">{f.label}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </CollapsibleSection>

          {/* 5. Language code — collapsible, rarely needed */}
          <CollapsibleSection
            title="Ngôn ngữ"
            icon={<Globe size={13} style={{ color: 'var(--accent)' }} />}
            defaultOpen={false}
          >
            <p className="text-[10px]" style={{ color: 'var(--muted)' }}>
              Chỉ định ngôn ngữ giúp chuẩn hóa phát âm (số, ngày tháng). Để trống = tự động.
            </p>
            <select
              className="w-full text-[11px] px-2 py-1.5 rounded-lg outline-none border"
              style={{ background: 'var(--surface)', color: 'var(--text)', borderColor: 'var(--border)' }}
              defaultValue=""
            >
              <option value="">Tự động phát hiện</option>
              <option value="vi">Tiếng Việt (vi)</option>
              <option value="en">English (en)</option>
              <option value="zh">中文 (zh)</option>
              <option value="ja">日本語 (ja)</option>
              <option value="ko">한국어 (ko)</option>
              <option value="fr">Français (fr)</option>
              <option value="es">Español (es)</option>
              <option value="de">Deutsch (de)</option>
              <option value="pt">Português (pt)</option>
              <option value="th">ภาษาไทย (th)</option>
              <option value="id">Bahasa Indonesia (id)</option>
            </select>
          </CollapsibleSection>
        </div>

        {/* ── RIGHT PANEL: Segments ── */}
        <div className="flex flex-col gap-3">

          {/* Batch control */}
          <div className="rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3"
            style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>

            {/* Stats */}
            <div className="flex items-center gap-3 text-[11px]" style={{ color: 'var(--muted)' }}>
              <span className="flex items-center gap-1"><List size={11} />{total}</span>
              {completed > 0 && <span className="flex items-center gap-1" style={{ color: 'var(--green)' }}><CheckCircle2 size={11} />{completed}</span>}
              {failed    > 0 && <span className="flex items-center gap-1" style={{ color: 'var(--red)'   }}><XCircle size={11} />{failed}</span>}
              {pending   > 0 && <span>{pending} chờ</span>}
            </div>

            <div className="flex items-center gap-2">
              <button onClick={addSegment}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border hover:bg-[rgba(255,255,255,0.04)]"
                style={{ borderColor: 'var(--border)', color: 'var(--muted)' }}>
                <Plus size={12} /> Thêm
              </button>

              {batchRunning ? (
                <button onClick={cancelBatch}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold border"
                  style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)', borderColor: 'rgba(239,68,68,0.25)' }}>
                  <Square size={11} /> Dừng
                </button>
              ) : (
                <button onClick={generateAll}
                  disabled={!selectedVoice || pending === 0 || apiKeyMissing}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white shadow transition-all"
                  style={{
                    background: (!selectedVoice || pending === 0 || apiKeyMissing) ? 'var(--surface)' : 'var(--accent)',
                    opacity:    (!selectedVoice || pending === 0 || apiKeyMissing) ? 0.4 : 1,
                  }}>
                  <SkipForward size={12} /> Tạo {pending > 0 ? `${pending} segment` : 'tất cả'}
                </button>
              )}
            </div>
          </div>

          {/* Batch progress */}
          {batchRunning && (
            <div className="px-4 py-2.5 rounded-xl flex flex-col gap-1.5"
              style={{ background: 'rgba(124,91,245,0.05)', border: '1px solid rgba(124,91,245,0.15)' }}>
              <div className="flex justify-between text-[11px]" style={{ color: 'var(--accent)' }}>
                <span className="flex items-center gap-1.5"><Loader2 size={11} className="spin" /> Đang tạo TTS hàng loạt...</span>
                <span>{completed}/{total}</span>
              </div>
              <div className="rounded-full overflow-hidden" style={{ height: 3, background: 'var(--surface)' }}>
                <div style={{ height: '100%', width: `${Math.round((completed / total) * 100)}%`, background: 'var(--accent)', transition: 'width 0.4s' }} />
              </div>
            </div>
          )}

          {/* Segment list */}
          <div className="flex flex-col gap-2" style={{ minHeight: 200 }}>
            {segments.length === 0 ? (
              <div className="rounded-xl py-16 flex flex-col items-center gap-3 border border-dashed"
                style={{ borderColor: 'var(--border)' }}>
                <AudioWaveform size={28} style={{ color: 'var(--border)' }} />
                <span className="text-[11px]" style={{ color: 'var(--muted)' }}>Chưa có segment</span>
                <button onClick={() => setShowImport(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold"
                  style={{ background: 'var(--accent)', color: '#fff' }}>
                  <FileUp size={12} /> Import TXT/CSV/SRT
                </button>
              </div>
            ) : (
              segments.map((seg, i) => (
                <SegmentCard key={seg.id} seg={seg} index={i}
                  onTextChange={updateText} onDelete={deleteSegment}
                  onGenerate={generateSegment} onPlay={playAudio}
                  isPlaying={isPlaying} currentPlayingId={currentPlayingId} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
