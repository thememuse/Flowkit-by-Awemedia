/**
 * ProductionPanel — Panel 5 bước sản xuất video
 * 
 * Step 1: Ảnh tham chiếu (GENERATE_CHARACTER_IMAGE)
 * Step 2: Ảnh cảnh (GENERATE_IMAGE)
 * Step 3: Video cảnh (GENERATE_VIDEO)
 * Step 4: Lời dẫn TTS (POST /api/videos/{vid}/narrate)
 * Step 5: Hậu kỳ (Review + Upscale + Export)
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Users, Image, Film, Volume2, Scissors,
  CheckCircle2, Circle, Clock, AlertCircle, Loader2,
  ChevronDown, ChevronRight, RefreshCw, Play,
  ArrowUpCircle, ScanEye, FolderOpen, X, Settings,
  MapPin, User, AlertTriangle,
} from 'lucide-react'
import { fetchAPI, postAPI } from '../../api/client'
import { useWebSocket } from '../../api/useWebSocket'
import type { Scene, Character, StatusType } from '../../types'

// ── Types ──────────────────────────────────────────────────
interface BatchStatus {
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  done: boolean
  all_succeeded: boolean
}

interface VoiceTemplate {
  name: string
  description?: string
  language?: string
}

interface StepStatus {
  done: boolean
  partial: boolean
  total: number
  completed: number
  failed: number
  processing: number
}

// ── Constants ──────────────────────────────────────────────
const ORI_KEY = (ori: string, field: string) =>
  `${ori.toLowerCase()}_${field}` as keyof Scene

// ── Inline progress bar ───────────────────────────────────
function MiniProgress({ completed, total, failed, processing }: {
  completed: number; total: number; failed: number; processing: number
}) {
  if (total === 0) return null
  const pct = Math.round((completed / total) * 100)
  const color = failed > 0 ? 'var(--red)' : processing > 0 ? 'var(--accent)' : 'var(--green)'
  return (
    <div className="flex flex-col gap-0.5 w-full">
      <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--surface)' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width 0.5s' }} />
      </div>
      <div className="flex gap-2 text-xs" style={{ color: 'var(--muted)' }}>
        <span style={{ color: 'var(--green)' }}>✓{completed}</span>
        {processing > 0 && <span style={{ color: 'var(--accent)' }}>⏳{processing}</span>}
        {failed > 0 && <span style={{ color: 'var(--red)' }}>✗{failed}</span>}
        <span className="ml-auto">{pct}%</span>
      </div>
    </div>
  )
}

// ── Step Header ───────────────────────────────────────────
function StepHeader({
  num, icon: Icon, label, status, isExpanded, onClick,
}: {
  num: number
  icon: React.ElementType
  label: string
  status: 'idle' | 'running' | 'partial' | 'done' | 'failed'
  isExpanded: boolean
  onClick: () => void
}) {
  const colors = {
    idle: 'var(--muted)',
    running: 'var(--accent)',
    partial: 'var(--yellow)',
    done: 'var(--green)',
    failed: 'var(--red)',
  }
  const icons = {
    idle: <Circle size={14} strokeWidth={1.5} />,
    running: <Loader2 size={14} className="spin" />,
    partial: <Clock size={14} />,
    done: <CheckCircle2 size={14} />,
    failed: <AlertCircle size={14} />,
  }
  const color = colors[status]

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2.5 py-1"
      style={{ cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}
    >
      <div
        className="w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold"
        style={{ background: color + '22', color }}
      >
        {status === 'done' ? '✓' : status === 'running' ? '' : num}
      </div>
      <Icon size={13} color={color} />
      <span className="text-xs font-semibold flex-1" style={{ color: status === 'idle' ? 'var(--muted)' : 'var(--text)' }}>
        {label}
      </span>
      <span style={{ color }}>{icons[status]}</span>
      {isExpanded ? <ChevronDown size={12} color="var(--muted)" /> : <ChevronRight size={12} color="var(--muted)" />}
    </button>
  )
}

// ── TTS Settings Modal ────────────────────────────────────
function TTSModal({
  videoId, projectId, orientation, templates, onClose, onDone,
}: {
  videoId: string
  projectId: string
  orientation: string
  templates: VoiceTemplate[]
  onClose: () => void
  onDone: () => void
}) {
  const [template, setTemplate] = useState(templates[0]?.name ?? '')
  const [instruct, setInstruct] = useState('Giọng đọc chuyên nghiệp, trầm ấm, nhịp độ vừa phải')
  const [speed, setSpeed] = useState(1.0)
  const [running, setRunning] = useState(false)
  const [log, setLog] = useState<string[]>([])

  async function handleStart() {
    setRunning(true)
    setLog(['⏳ Đang tạo lời dẫn TTS...'])
    try {
      const res = await postAPI<{
        scenes_narrated: number
        scenes_skipped: number
        scenes_failed: number
        total_narration_duration?: number
      }>(`/api/videos/${videoId}/narrate`, {
        project_id: projectId,
        template: template || undefined,
        instruct,
        speed,
        orientation,
      })
      setLog(prev => [
        ...prev,
        `✓ Hoàn thành: ${res.scenes_narrated} cảnh`,
        res.scenes_skipped > 0 ? `⏭ Bỏ qua: ${res.scenes_skipped} (không có narrator_text)` : '',
        res.scenes_failed > 0 ? `✗ Lỗi: ${res.scenes_failed} cảnh` : '',
        res.total_narration_duration ? `⏱ Tổng thời lượng: ${res.total_narration_duration.toFixed(1)}s` : '',
      ].filter(Boolean))
      onDone()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setLog(prev => [...prev, `✗ Lỗi: ${msg}`])
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.7)' }}>
      <div className="rounded-xl flex flex-col gap-4 w-full" style={{
        maxWidth: 440, background: 'var(--card)', border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        {/* Header */}
        <div className="px-5 pt-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Volume2 size={16} color="var(--accent)" />
            <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>Tạo lời dẫn TTS</span>
          </div>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}><X size={16} /></button>
        </div>

        <div className="px-5 flex flex-col gap-3">
          {/* Voice template */}
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Voice template</label>
            {templates.length > 0 ? (
              <select
                value={template}
                onChange={e => setTemplate(e.target.value)}
                style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 12, outline: 'none' }}
              >
                <option value="">— Không dùng template —</option>
                {templates.map(t => (
                  <option key={t.name} value={t.name}>{t.name}</option>
                ))}
              </select>
            ) : (
              <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertTriangle size={12} style={{ color: 'var(--yellow)', flexShrink: 0 }} /> Chưa có voice template. Tạo trong Cài đặt → TTS.
              </div>
            )}
          </div>

          {/* Style instruction */}
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Phong cách giọng đọc</label>
            <input
              value={instruct}
              onChange={e => setInstruct(e.target.value)}
              placeholder="Giọng chuyên nghiệp, trầm ấm..."
              style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 12, outline: 'none' }}
            />
          </div>

          {/* Speed */}
          <div className="flex items-center gap-3">
            <label className="text-xs flex-shrink-0" style={{ color: 'var(--muted)' }}>Tốc độ: {speed.toFixed(1)}x</label>
            <input
              type="range" min={0.5} max={2.0} step={0.1}
              value={speed}
              onChange={e => setSpeed(Number(e.target.value))}
              style={{ flex: 1, accentColor: 'var(--accent)' }}
            />
          </div>

          {/* Log */}
          {log.length > 0 && (
            <div className="rounded-lg p-3 text-xs font-mono flex flex-col gap-0.5" style={{
              background: '#080810', border: '1px solid var(--border)', maxHeight: 100, overflowY: 'auto',
            }}>
              {log.map((line, i) => (
                <div key={i} style={{ color: line.includes('✗') ? 'var(--red)' : line.includes('✓') ? 'var(--green)' : 'var(--muted)' }}>
                  {line}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-secondary text-xs">Đóng</button>
          <button
            onClick={handleStart}
            disabled={running}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold"
            style={{ background: 'var(--accent)', color: '#fff', opacity: running ? 0.7 : 1 }}
          >
            {running ? <><Loader2 size={11} className="spin" /> Đang tạo...</> : <><Play size={11} /> Bắt đầu TTS</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main ProductionPanel ─────────────────────────────────
interface Props {
  projectId: string
  videoId: string
  orientation: string
  onLog: (msg: string) => void
  onRunningChange?: (running: boolean) => void
}

type StepKey = 'refs' | 'images' | 'videos' | 'tts' | 'export'

export default function ProductionPanel({ projectId, videoId, orientation, onLog, onRunningChange }: Props) {
  const [chars, setChars] = useState<Character[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [templates, setTemplates] = useState<VoiceTemplate[]>([])
  const [expanded, setExpanded] = useState<StepKey | null>('refs')
  const [showTTSModal, setShowTTSModal] = useState(false)

  // Active batch jobs being polled
  // jobMeta stores stepKey → { jobType, since } where `since` is the ISO timestamp at submit time
  // Using `since` in batch-status prevents old COMPLETED/PROCESSING records from inflating counts
  const [activeJobs, setActiveJobs] = useState<Record<string, string>>({}) // stepKey → jobType
  const [_jobMeta, setJobMeta] = useState<Record<string, { jobType: string; since: string }>>({})
  const [jobStatus, setJobStatus] = useState<Record<string, BatchStatus>>({})
  const pollRefs = useRef<Record<string, ReturnType<typeof setInterval>>>({})

  // Per-step loading
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [upscaleRunning, setUpscaleRunning] = useState(false)
  const [reviewRunning, setReviewRunning] = useState(false)
  const [reviewResult, setReviewResult] = useState<string | null>(null)

  const { lastEvent } = useWebSocket()

  const ori = orientation.toLowerCase()

  const load = useCallback(async () => {
    const [c, s, t] = await Promise.all([
      fetchAPI<Character[]>(`/api/projects/${projectId}/characters`).catch(() => [] as Character[]),
      fetchAPI<Scene[]>(`/api/scenes?video_id=${videoId}`).catch(() => [] as Scene[]),
      fetchAPI<VoiceTemplate[]>('/api/tts/templates').catch(() => [] as VoiceTemplate[]),
    ])
    setChars(c)
    setScenes(s)
    setTemplates(t)
  }, [projectId, videoId])

  useEffect(() => { load() }, [load])

  // WebSocket real-time
  useEffect(() => {
    if (!lastEvent) return
    const t = lastEvent.type
    if (['scene_updated', 'character_updated', 'request_completed', 'request_failed'].includes(t)) {
      load()
    }
  }, [lastEvent, load])

  // Notify parent when active jobs change (for cross-tab status indicator)
  useEffect(() => {
    onRunningChange?.(Object.keys(activeJobs).length > 0)
  }, [activeJobs, onRunningChange])

  // Poll batch status — uses `since` to only count requests from this session
  const startPoll = useCallback((stepKey: StepKey, jobType: string, queryParam: string, since: string) => {
    if (pollRefs.current[stepKey]) clearInterval(pollRefs.current[stepKey])
    setActiveJobs(prev => ({ ...prev, [stepKey]: jobType }))
    setJobMeta(prev => ({ ...prev, [stepKey]: { jobType, since } }))

    const poll = async () => {
      try {
        // Append `since` so we only see requests from this submit, not stale ones from previous sessions
        const s = await fetchAPI<BatchStatus>(
          `/api/requests/batch-status?${queryParam}&type=${jobType}&since=${encodeURIComponent(since)}`
        )
        setJobStatus(prev => ({ ...prev, [stepKey]: s }))
        if (s.done) {
          clearInterval(pollRefs.current[stepKey])
          onLog(s.all_succeeded
            ? `✓ ${jobType} hoàn thành (${s.completed}/${s.total})`
            : `⚠️ ${jobType} xong, ${s.failed} lỗi`)
          load()
          // Keep job visible briefly then clear
          setTimeout(() => {
            setActiveJobs(prev => { const n = { ...prev }; delete n[stepKey]; return n })
            setJobMeta(prev => { const n = { ...prev }; delete n[stepKey]; return n })
          }, 5000)
        }
      } catch (_) {}
    }
    poll()
    pollRefs.current[stepKey] = setInterval(poll, 3000)
  }, [load, onLog])

  useEffect(() => () => Object.values(pollRefs.current).forEach(clearInterval), [])

  // ── Derived step stats ────────────────────────────────
  const imgSt = (s: Scene) => s[ORI_KEY(ori, 'image_status')] as StatusType
  const vidSt = (s: Scene) => s[ORI_KEY(ori, 'video_status')] as StatusType
  const upsSt = (s: Scene) => s[ORI_KEY(ori, 'upscale_status')] as StatusType

  const st: Record<StepKey, StepStatus> = {
    refs: {
      total: chars.length,
      completed: chars.filter(c => c.media_id).length,
      failed: 0,
      processing: 0,
      done: chars.length > 0 && chars.every(c => c.media_id),
      partial: chars.length > 0 && chars.some(c => c.media_id) && !chars.every(c => c.media_id),
    },
    images: {
      total: scenes.length,
      completed: scenes.filter(s => imgSt(s) === 'COMPLETED').length,
      failed: scenes.filter(s => imgSt(s) === 'FAILED').length,
      processing: scenes.filter(s => imgSt(s) === 'PROCESSING').length,
      done: scenes.length > 0 && scenes.every(s => imgSt(s) === 'COMPLETED'),
      partial: scenes.some(s => imgSt(s) === 'COMPLETED'),
    },
    videos: {
      total: scenes.length,
      completed: scenes.filter(s => vidSt(s) === 'COMPLETED').length,
      failed: scenes.filter(s => vidSt(s) === 'FAILED').length,
      processing: scenes.filter(s => vidSt(s) === 'PROCESSING').length,
      done: scenes.length > 0 && scenes.every(s => vidSt(s) === 'COMPLETED'),
      partial: scenes.some(s => vidSt(s) === 'COMPLETED'),
    },
    tts: {
      total: scenes.length,
      completed: scenes.filter(s => s.narrator_text && s.narrator_text.trim()).length,
      failed: 0,
      processing: 0,
      done: scenes.length > 0 && scenes.every(s => s.narrator_text?.trim()),
      partial: scenes.some(s => s.narrator_text?.trim()),
    },
    export: {
      total: scenes.length,
      completed: scenes.filter(s => upsSt(s) === 'COMPLETED').length,
      failed: scenes.filter(s => upsSt(s) === 'FAILED').length,
      processing: scenes.filter(s => upsSt(s) === 'PROCESSING').length,
      done: false,
      partial: scenes.some(s => upsSt(s) === 'COMPLETED'),
    },
  }

  function deriveStepStatus(key: StepKey): 'idle' | 'running' | 'partial' | 'done' | 'failed' {
    if (activeJobs[key]) return 'running'
    const s = st[key]
    if (s.done) return 'done'
    if (s.failed > 0 && s.failed === s.total - s.completed) return 'failed'
    if (s.partial || s.processing > 0) return 'partial'
    return 'idle'
  }

  // ── Actions ───────────────────────────────────────────
  async function genRefs() {
    const missing = chars.filter(c => !c.media_id)
    if (missing.length === 0) { onLog('✓ Tất cả đã có ảnh tham chiếu'); return }
    setLoading(p => ({ ...p, refs: true }))
    try {
      const since = new Date().toISOString()
      await postAPI('/api/requests/batch', {
        requests: missing.map(c => ({
          type: 'GENERATE_CHARACTER_IMAGE',
          character_id: c.id,
          project_id: projectId,
          orientation: c.entity_type === 'location' ? 'HORIZONTAL' : 'VERTICAL',
        }))
      })
      onLog(`Gửi ${missing.length} requests tạo ảnh tham chiếu`)
      startPoll('refs', 'GENERATE_CHARACTER_IMAGE', `project_id=${projectId}`, since)
    } catch (e: unknown) {
      onLog(`Lỗi: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(p => ({ ...p, refs: false }))
    }
  }

  async function genImages() {
    // Skip scenes already COMPLETED or actively PROCESSING (from a previous session still in queue)
    const need = scenes.filter(s => imgSt(s) !== 'COMPLETED' && imgSt(s) !== 'PROCESSING')
    if (need.length === 0) {
      const processing = scenes.filter(s => imgSt(s) === 'PROCESSING').length
      if (processing > 0) {
        onLog(`${processing} cảnh đang xử lý — tiếp tục theo dõi`)
        startPoll('images', 'GENERATE_IMAGE', `video_id=${videoId}`, new Date(Date.now() - 3600000).toISOString())
      } else {
        onLog('✓ Tất cả cảnh đã có ảnh')
      }
      return
    }
    setLoading(p => ({ ...p, images: true }))
    try {
      const since = new Date().toISOString()
      await postAPI('/api/requests/batch', {
        requests: need.map(s => ({
          type: 'GENERATE_IMAGE',
          scene_id: s.id,
          project_id: projectId,
          video_id: videoId,
          orientation,
        }))
      })
      onLog(`Gửi ${need.length} requests tạo ảnh cảnh`)
      startPoll('images', 'GENERATE_IMAGE', `video_id=${videoId}`, since)
    } catch (e: unknown) {
      onLog(`Lỗi: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(p => ({ ...p, images: false }))
    }
  }

  async function genVideos() {
    // Only submit scenes that have an image AND are not already COMPLETED or PROCESSING
    // This prevents: submitting 20 scenes when 2 are still PROCESSING from a previous session
    // (which would create 20 new + keep 2 old → batch-status shows total=22)
    const need = scenes.filter(s =>
      imgSt(s) === 'COMPLETED' &&
      vidSt(s) !== 'COMPLETED' &&
      vidSt(s) !== 'PROCESSING'  // skip scenes already queued from previous session
    )
    const alreadyProcessing = scenes.filter(s =>
      imgSt(s) === 'COMPLETED' && vidSt(s) === 'PROCESSING'
    ).length

    if (need.length === 0) {
      if (alreadyProcessing > 0) {
        onLog(`${alreadyProcessing} cảnh đang xử lý — tiếp tục theo dõi`)
        // Resume polling for the in-progress batch (use 1hr ago so we catch ongoing ones)
        startPoll('videos', 'GENERATE_VIDEO', `video_id=${videoId}`, new Date(Date.now() - 3600000).toISOString())
      } else {
        onLog('✓ Tất cả cảnh đã có video hoặc chưa có ảnh')
      }
      return
    }

    setLoading(p => ({ ...p, videos: true }))
    try {
      const since = new Date().toISOString()
      await postAPI('/api/requests/batch', {
        requests: need.map(s => ({
          type: 'GENERATE_VIDEO',
          scene_id: s.id,
          project_id: projectId,
          video_id: videoId,
          orientation,
        }))
      })
      onLog(`Gửi ${need.length} requests tạo video${alreadyProcessing > 0 ? ` (+${alreadyProcessing} đang xử lý)` : ''} • 2-5 phút/cảnh`)
      startPoll('videos', 'GENERATE_VIDEO', `video_id=${videoId}`, since)
    } catch (e: unknown) {
      onLog(`Lỗi: ${e instanceof Error ? e.message : e}`)
    } finally {
      setLoading(p => ({ ...p, videos: false }))
    }
  }

  async function genUpscale() {
    const need = scenes.filter(s => vidSt(s) === 'COMPLETED' && upsSt(s) !== 'COMPLETED')
    if (need.length === 0) { onLog('Chưa có video hoàn thành để upscale'); return }
    setUpscaleRunning(true)
    try {
      await postAPI('/api/requests/batch', {
        requests: need.map(s => ({
          type: 'UPSCALE_VIDEO',
          scene_id: s.id,
          project_id: projectId,
          video_id: videoId,
          orientation,
        }))
      })
      onLog(`📤 Gửi ${need.length} requests upscale 4K`)
      startPoll('export', 'UPSCALE_VIDEO', `video_id=${videoId}`, new Date().toISOString())
    } catch (e: unknown) {
      onLog(`✗ Lỗi upscale: ${e instanceof Error ? e.message : e}`)
    } finally {
      setUpscaleRunning(false)
    }
  }

  async function runReview() {
    setReviewRunning(true)
    setReviewResult(null)
    onLog('🔍 Đang review video bằng Claude Vision...')
    try {
      const res = await postAPI<{ scenes?: unknown[]; error?: string }>(
        `/api/videos/${videoId}/review?mode=light`, { project_id: projectId }
      )
      if (res.error) {
        setReviewResult(`✗ Lỗi: ${res.error}`)
        onLog(`✗ Review lỗi: ${res.error}`)
      } else {
        const cnt = Array.isArray(res.scenes) ? res.scenes.length : 0
        setReviewResult(`✓ Đã review ${cnt} cảnh`)
        onLog(`✓ Review hoàn thành — ${cnt} cảnh`)
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setReviewResult(`✗ ${msg}`)
      onLog(`✗ Review lỗi: ${msg}`)
    } finally {
      setReviewRunning(false)
    }
  }

  async function retryFailed(type: 'images' | 'videos') {
    const key = type === 'images' ? 'image' : 'video'
    const reqType = type === 'images' ? 'REGENERATE_IMAGE' : 'GENERATE_VIDEO'
    const stFn = type === 'images' ? imgSt : vidSt
    const failed = scenes.filter(s => stFn(s) === 'FAILED')
    if (!failed.length) return
    const since = new Date().toISOString()
    await postAPI('/api/requests/batch', {
      requests: failed.map(s => ({
        type: reqType,
        scene_id: s.id,
        project_id: projectId,
        video_id: videoId,
        orientation,
      }))
    })
    onLog(`Retry ${failed.length} cảnh ${key} lỗi`)
    startPoll(type, reqType, `video_id=${videoId}`, since)
  }

  const toggle = (k: StepKey) => setExpanded(prev => prev === k ? null : k)

  // ── Render step body ──────────────────────────────────
  function StepBody({ stepKey }: { stepKey: StepKey }) {
    const s = st[stepKey]
    const job = activeJobs[stepKey]
    const js = jobStatus[stepKey]
    const isRunning = !!job

    return (
      <div className="flex flex-col gap-3 pt-1 pb-3 px-1">
        {/* Stats row */}
        <div className="flex gap-3 text-xs" style={{ color: 'var(--muted)' }}>
          {s.total > 0 ? (
            <>
              <span style={{ color: 'var(--green)' }}>✓ {s.completed} xong</span>
              {s.processing > 0 && <span style={{ color: 'var(--accent)' }}>⏳ {s.processing} đang xử lý</span>}
              {s.failed > 0 && <span style={{ color: 'var(--red)' }}>✗ {s.failed} lỗi</span>}
              <span className="ml-auto">Tổng: {s.total}</span>
            </>
          ) : (
            <span>Chưa có dữ liệu</span>
          )}
        </div>

        {/* Inline progress if job active — uses scene stats as source of truth, not batch-status counts */}
        {isRunning && (
          <div className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'rgba(124,91,245,0.08)', border: '1px solid rgba(124,91,245,0.2)' }}>
            <div className="flex justify-between text-xs" style={{ color: 'var(--accent)' }}>
              <span className="flex items-center gap-1"><Loader2 size={10} className="spin" /> {job}</span>
              {/* Use scene-derived counts (always accurate) — not js counts (may include stale requests) */}
              <span>{s.completed}/{s.total} cảnh</span>
            </div>
            <MiniProgress
              completed={s.completed}
              total={s.total}
              failed={s.failed}
              processing={s.processing}
            />
            {/* Show batch-status done signal only for debugging */}
            {js && js.pending === 0 && js.processing === 0 && js.total > 0 && (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                Queue: {js.completed}/{js.total} done
              </div>
            )}
          </div>
        )}

        {/* Step-specific actions */}
        {stepKey === 'refs' && (
          <div className="flex flex-col gap-2">
            {/* Character grid */}
            {chars.length > 0 && (
              <div className="grid gap-1.5" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))' }}>
                {chars.map(c => (
                  <div key={c.id} className="flex flex-col gap-1 rounded-lg p-1.5 text-center"
                    style={{ background: 'var(--surface)', border: `1px solid ${c.media_id ? 'var(--border)' : 'rgba(239,68,68,0.3)'}` }}>
                    <div className="rounded overflow-hidden flex items-center justify-center"
                      style={{ aspectRatio: '3/4', background: 'var(--card)', maxHeight: 56 }}>
                      {c.reference_image_url
                        ? <img src={c.reference_image_url} alt={c.name} className="w-full h-full object-cover" />
                        : <span style={{ color: 'var(--muted)' }}>{c.entity_type === 'location' ? <MapPin size={16} /> : <User size={16} />}</span>
                      }
                    </div>
                    <span className="text-xs truncate font-medium" style={{ color: 'var(--text)', fontSize: 10 }}>{c.name}</span>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: c.media_id ? 'var(--green)' : 'var(--red)', margin: '0 auto' }} />
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={genRefs}
              disabled={loading.refs || isRunning || s.done}
              className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-bold w-full"
              style={{
                background: s.done ? 'var(--surface)' : 'var(--accent)',
                color: s.done ? 'var(--muted)' : '#fff',
                opacity: (loading.refs || isRunning) ? 0.7 : 1,
                cursor: s.done ? 'default' : 'pointer',
              }}
            >
              {loading.refs || isRunning
                ? <><Loader2 size={12} className="spin" /> Đang gửi...</>
                : s.done
                  ? <><CheckCircle2 size={12} /> Đã hoàn thành</>
                  : <><Play size={12} /> Tạo ảnh tham chiếu ({chars.filter(c => !c.media_id).length} chưa có)</>
              }
            </button>
          </div>
        )}

        {stepKey === 'images' && (
          <div className="flex flex-col gap-2">
            <button
              onClick={genImages}
              disabled={loading.images || isRunning}
              className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-bold"
              style={{ background: 'var(--accent)', color: '#fff', opacity: (loading.images || isRunning) ? 0.7 : 1 }}
            >
              {loading.images || isRunning
                ? <><Loader2 size={12} className="spin" /> Đang gửi...</>
                : <><Play size={12} /> {s.completed > 0 ? `Tiếp tục (${s.total - s.completed} còn lại)` : `Tạo ảnh ${s.total} cảnh`}</>
              }
            </button>
            {s.failed > 0 && (
              <button
                onClick={() => retryFailed('images')}
                className="flex items-center justify-center gap-2 py-1.5 px-4 rounded-lg text-xs"
                style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                <RefreshCw size={10} /> Retry {s.failed} cảnh lỗi
              </button>
            )}
          </div>
        )}

        {stepKey === 'videos' && (
          <div className="flex flex-col gap-2">
            {!st.images.partial && !st.images.done && (
              <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertTriangle size={12} style={{ color: 'var(--yellow)', flexShrink: 0 }} /> Cần tạo ảnh cảnh trước
              </div>
            )}
            <button
              onClick={genVideos}
              disabled={loading.videos || isRunning || !st.images.partial}
              className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-bold"
              style={{
                background: 'var(--accent)', color: '#fff',
                opacity: (loading.videos || isRunning || !st.images.partial) ? 0.5 : 1,
              }}
            >
              {loading.videos || isRunning
                ? <><Loader2 size={12} className="spin" /> Đang gửi...</>
                : <><Play size={12} /> Tạo video ({scenes.filter(s => imgSt(s) === 'COMPLETED' && vidSt(s) !== 'COMPLETED').length} cảnh • 2-5 phút/cảnh)</>
              }
            </button>
            {s.failed > 0 && (
              <button
                onClick={() => retryFailed('videos')}
                className="flex items-center justify-center gap-2 py-1.5 px-4 rounded-lg text-xs"
                style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                <RefreshCw size={10} /> Retry {s.failed} cảnh lỗi
              </button>
            )}
          </div>
        )}

        {stepKey === 'tts' && (
          <div className="flex flex-col gap-2">
            {/* Per-scene narrator preview */}
            {scenes.length > 0 && (
              <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
                {scenes.map((scene, i) => (
                  <div key={scene.id} className="flex items-start gap-2 text-xs"
                    style={{ color: scene.narrator_text ? 'var(--text)' : 'var(--muted)' }}>
                    <span className="flex-shrink-0" style={{ color: 'var(--muted)', minWidth: 20 }}>#{i + 1}</span>
                    <span className="truncate">{scene.narrator_text || '(chưa có lời dẫn)'}</span>
                    {scene.narrator_text && <span style={{ color: 'var(--green)', flexShrink: 0 }}>✓</span>}
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={() => setShowTTSModal(true)}
              className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-bold"
              style={{ background: 'var(--purple-dim)', color: 'var(--purple)', border: '1px solid rgba(181,123,238,0.25)' }}
            >
              <Settings size={12} /> Cài đặt &amp; Tạo TTS
            </button>
          </div>
        )}

        {stepKey === 'export' && (
          <div className="flex flex-col gap-2">
            {/* Review */}
            <button
              onClick={runReview}
              disabled={reviewRunning || !st.videos.partial}
              className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-bold"
              style={{
                background: 'rgba(34,197,94,0.12)', color: 'var(--green)',
                border: '1px solid rgba(34,197,94,0.25)',
                opacity: (reviewRunning || !st.videos.partial) ? 0.5 : 1,
              }}
            >
              {reviewRunning ? <><Loader2 size={11} className="spin" /> Đang review...</> : <><ScanEye size={12} /> Review Claude Vision</>}
            </button>
            {reviewResult && (
              <div className="text-xs p-2 rounded" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{reviewResult}</div>
            )}

            {/* Upscale 4K */}
            <button
              onClick={genUpscale}
              disabled={upscaleRunning || isRunning || !st.videos.partial}
              className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs font-bold"
              style={{
                background: 'var(--purple-dim)', color: 'var(--purple)',
                border: '1px solid rgba(181,123,238,0.25)',
                opacity: (upscaleRunning || isRunning || !st.videos.partial) ? 0.5 : 1,
              }}
            >
              {upscaleRunning || isRunning
                ? <><Loader2 size={11} className="spin" /> Đang nâng cấp...</>
                : <><ArrowUpCircle size={12} /> Nâng cấp 4K ({scenes.filter(s => vidSt(s) === 'COMPLETED' && upsSt(s) !== 'COMPLETED').length} video)</>
              }
            </button>

            {/* Open folder */}
            <button
              onClick={async () => {
                const electronAPI = (window as unknown as { electronAPI?: { revealFile?: (p: string) => void } }).electronAPI
                if (electronAPI?.revealFile) {
                  try {
                    const outDir = await fetchAPI<{ path: string }>(`/api/projects/${projectId}/output-dir`)
                    electronAPI.revealFile(outDir.path)
                    return
                  } catch (_) {}
                }
                try {
                  await postAPI(`/api/projects/${projectId}/open-folder`, {})
                } catch (err) {
                  console.error("Failed to open folder:", err)
                }
              }}
              className="flex items-center justify-center gap-2 py-2 px-4 rounded-lg text-xs"
              style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
            >
              <FolderOpen size={12} /> Mở thư mục output
            </button>
          </div>
        )}
      </div>
    )
  }

  const steps: { key: StepKey; label: string; icon: React.ElementType; desc: string }[] = [
    { key: 'refs',   label: 'Ảnh tham chiếu',  icon: Users,   desc: `${st.refs.completed}/${st.refs.total} nhân vật` },
    { key: 'images', label: 'Ảnh cảnh',         icon: Image,   desc: `${st.images.completed}/${st.images.total} cảnh` },
    { key: 'videos', label: 'Video cảnh',        icon: Film,    desc: `${st.videos.completed}/${st.videos.total} • 2-5ph/cảnh` },
    { key: 'tts',    label: 'Lời dẫn TTS',      icon: Volume2, desc: `${st.tts.completed}/${st.tts.total} cảnh có lời` },
    { key: 'export', label: 'Hậu kỳ & Xuất',    icon: Scissors, desc: 'Review • 4K • Export' },
  ]

  return (
    <div className="flex flex-col gap-1">
      {/* Compact progress overview */}
      <div className="flex gap-1 mb-2">
        {steps.map(step => {
          const status = deriveStepStatus(step.key)
          const color = { idle: 'var(--border)', running: 'var(--accent)', partial: 'var(--yellow)', done: 'var(--green)', failed: 'var(--red)' }[status]
          return (
            <div key={step.key} className="flex-1 rounded" style={{ height: 3, background: color, transition: 'background 0.3s' }} />
          )
        })}
      </div>

      {/* Step cards */}
      {steps.map((step) => {
        const status = deriveStepStatus(step.key)
        const isOpen = expanded === step.key
        return (
          <div
            key={step.key}
            className="rounded-lg overflow-hidden"
            style={{
              background: 'var(--card)',
              border: `1px solid ${isOpen ? 'var(--accent)' : 'var(--border)'}`,
              transition: 'border-color 0.2s',
            }}
          >
            <div className="px-3 pt-2.5">
              <StepHeader
                num={steps.findIndex(s => s.key === step.key) + 1}
                icon={step.icon}
                label={step.label}
                status={status}
                isExpanded={isOpen}
                onClick={() => toggle(step.key)}
              />
              {/* Sub-label */}
              <div className="text-xs mb-1.5 ml-9" style={{ color: 'var(--muted)' }}>{step.desc}</div>
              {/* Mini progress */}
              {(step.key !== 'refs' || st.refs.total > 0) && step.key !== 'export' && (
                <div className="ml-9 mb-2">
                  <MiniProgress
                    completed={st[step.key].completed}
                    total={st[step.key].total}
                    failed={st[step.key].failed}
                    processing={st[step.key].processing}
                  />
                </div>
              )}
            </div>

            {/* Expanded body */}
            {isOpen && (
              <div className="px-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <StepBody stepKey={step.key} />
              </div>
            )}
          </div>
        )
      })}

      {/* Refresh */}
      <button
        onClick={load}
        className="flex items-center justify-center gap-1.5 py-1.5 rounded text-xs mt-1"
        style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
      >
        <RefreshCw size={10} /> Tải lại trạng thái
      </button>

      {/* TTS Modal */}
      {showTTSModal && (
        <TTSModal
          videoId={videoId}
          projectId={projectId}
          orientation={orientation}
          templates={templates}
          onClose={() => setShowTTSModal(false)}
          onDone={() => { setShowTTSModal(false); load() }}
        />
      )}

      <style>{`
        .spin { animation: spin 1s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
