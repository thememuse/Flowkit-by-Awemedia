import { useState, useEffect, useRef } from 'react'
import { postAPI, fetchAPI, deleteAPI } from '../../api/client'
import type { Project, Character, Video } from '../../types'
import { Bot, Zap, CheckCircle, XCircle, Clock, Loader2, ChevronRight,
  X, RefreshCw, ExternalLink
} from 'lucide-react'
import AIProviderPicker from './AIProviderPicker'

// ── Types ──────────────────────────────────────────────────────
interface PipelineStep {
  name: string
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  detail: string
  started_at?: number
  finished_at?: number
}

interface PipelineJobStatus {
  job_id: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  current_step: string
  steps: PipelineStep[]
  video_id?: string
  scene_count: number
  error?: string
  elapsed_secs?: number
}

interface Props {
  project: Project
  characters: Character[]
  existingVideos: Video[]
  onCreated: (videoId: string) => void
  onCancel: () => void
}

const INPUT: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  padding: '7px 10px',
  fontSize: 12,
  outline: 'none',
  width: '100%',
}

// ── Step Icon ──────────────────────────────────────────────────
function StepIcon({ status }: { status: PipelineStep['status'] }) {
  if (status === 'done')    return <CheckCircle size={14} color="var(--green)" />
  if (status === 'failed')  return <XCircle size={14} color="var(--red)" />
  if (status === 'skipped') return <ChevronRight size={14} color="var(--muted)" />
  if (status === 'running') return <Loader2 size={14} color="var(--accent)" className="spin" />
  return <Clock size={14} color="var(--muted)" />
}

// ── Step Row ──────────────────────────────────────────────────
function StepRow({ step, isCurrent }: { step: PipelineStep; isCurrent: boolean }) {
  const elapsed = step.started_at && step.finished_at
    ? `${(step.finished_at - step.started_at).toFixed(0)}s`
    : step.started_at && step.status === 'running'
    ? `${(Date.now() / 1000 - step.started_at).toFixed(0)}s...`
    : null

  const borderColor = step.status === 'done' ? 'var(--green)'
    : step.status === 'failed' ? 'var(--red)'
    : step.status === 'running' ? 'var(--accent)'
    : 'var(--border)'

  return (
    <div
      className="flex items-start gap-3 rounded-lg p-3 transition-all"
      style={{
        background: isCurrent ? 'rgba(124,91,245,0.06)' : 'var(--card)',
        border: `1px solid ${borderColor}`,
        opacity: step.status === 'pending' ? 0.5 : 1,
      }}
    >
      <div className="flex-shrink-0 mt-0.5">
        <StepIcon status={step.status} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
            {step.name}
          </span>
          {elapsed && (
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{elapsed}</span>
          )}
        </div>
        {step.detail && (
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
            {step.detail}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────
export default function AutoPipelineModal({
  project, characters, existingVideos, onCreated, onCancel
}: Props) {
  const [phase, setPhase] = useState<'config' | 'running' | 'done'>('config')

  // Config state
  const [title, setTitle] = useState('')
  const [brief, setBrief] = useState('')
  const [sceneCount, setSceneCount] = useState(10)
  const [orientation, setOrientation] = useState<'VERTICAL' | 'HORIZONTAL'>(
    (existingVideos[0]?.orientation as 'VERTICAL' | 'HORIZONTAL') ?? 'VERTICAL'
  )
  const [includeRefs, setIncludeRefs] = useState(true)
  const [autoReview, setAutoReview] = useState(false)
  const [styleNotes, setStyleNotes] = useState('')
  const [provider, setProvider] = useState('auto')  // 'auto'|'claude'|'openai'|'gemini'

  // Job state
  const [jobId, setJobId] = useState<string | null>(null)
  const [jobStatus, setJobStatus] = useState<PipelineJobStatus | null>(null)
  const [elapsedDisplay, setElapsedDisplay] = useState(0)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  const epNumber = existingVideos.length + 1

  // Elapsed timer display
  useEffect(() => {
    if (phase === 'running') {
      startTimeRef.current = Date.now()
      timerRef.current = setInterval(() => {
        setElapsedDisplay(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [phase])

  // Poll job status
  useEffect(() => {
    if (!jobId || phase !== 'running') return
    pollRef.current = setInterval(async () => {
      try {
        const status = await fetchAPI<PipelineJobStatus>(`/api/ai/auto-pipeline/${jobId}`)
        setJobStatus(status)
        if (status.status !== 'running') {
          clearInterval(pollRef.current!)
          if (timerRef.current) clearInterval(timerRef.current)
          setPhase('done')
        }
      } catch (_) {}
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [jobId, phase])

  async function handleStart() {
    if (!title.trim() || !brief.trim()) return
    setPhase('running')
    try {
      const resp = await postAPI<PipelineJobStatus>('/api/ai/auto-pipeline', {
        project_id: project.id,
        episode_title: title.trim(),
        episode_brief: brief.trim(),
        scene_count: sceneCount,
        orientation,
        include_refs: includeRefs,
        auto_review: autoReview,
        style_notes: styleNotes || undefined,
        provider: provider === 'auto' ? undefined : provider,
      })
      setJobId(resp.job_id)
      setJobStatus(resp)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setJobStatus({
        job_id: '',
        status: 'failed',
        current_step: '',
        steps: [],
        scene_count: 0,
        error: msg,
      })
      setPhase('done')
    }
  }

  async function handleCancel() {
    if (jobId) {
      try {
        await deleteAPI(`/api/ai/auto-pipeline/${jobId}`)
      } catch (_) {}
    }
    onCancel()
  }

  const formatTime = (secs: number) => {
    if (secs < 60) return `${secs}s`
    return `${Math.floor(secs / 60)}m ${secs % 60}s`
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(6px)' }}
    >
      <div
        className="rounded-2xl flex flex-col"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          width: '94%',
          maxWidth: 560,
          maxHeight: '90vh',
        }}
      >
        {/* ── Header ── */}
        <div
          className="px-6 pt-5 pb-4 flex items-start justify-between"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div>
            <div className="flex items-center gap-2">
              <div
                className="flex items-center justify-center rounded-lg"
                style={{ width: 28, height: 28, background: 'rgba(124,91,245,0.15)' }}
              >
                <Zap size={14} color="var(--accent)" />
              </div>
              <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>
                Auto-Pipeline — Tập {epNumber}
              </span>
            </div>
            <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              {project.name} • {characters.length} nhân vật • Tự động từ kịch bản đến video
            </div>
          </div>
          {phase !== 'running' && (
            <button onClick={onCancel} style={{ color: 'var(--muted)', padding: 4 }}>
              <X size={16} />
            </button>
          )}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-auto">

          {/* CONFIG */}
          {phase === 'config' && (
            <div className="p-6 flex flex-col gap-4">

              {/* Project context */}
              <div
                className="rounded-lg p-3"
                style={{ background: 'rgba(124,91,245,0.07)', border: '1px solid rgba(124,91,245,0.18)' }}
              >
                <div className="text-xs font-semibold mb-2" style={{ color: 'var(--accent)' }}>
                  Quy trình tự động
                </div>
                <div className="flex flex-col gap-1">
                  {[
                    `AI viết kịch bản ${sceneCount} cảnh`,
                    'Tạo video + scenes trong DB',
                    includeRefs ? 'Tạo ảnh tham chiếu nhân vật' : 'Bỏ qua ảnh tham chiếu',
                    'Tạo ảnh mỗi cảnh (2-5 phút)',
                    'Tạo video mỗi cảnh (2-5 phút/cảnh)',
                    autoReview ? 'Review chất lượng tự động' : 'Review: bỏ qua',
                  ].map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                      <span style={{ color: 'var(--accent)', fontWeight: 700 }}>{i + 1}.</span>
                      {step}
                    </div>
                  ))}
                </div>
              </div>

              {/* Episode title */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Tên tập {epNumber} *
                </label>
                <input
                  autoFocus
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder={`VD: Tập ${epNumber} — Cuộc phản công`}
                  style={INPUT}
                />
              </div>

              {/* Brief */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Nội dung / Tóm tắt tập *
                </label>
                <textarea
                  value={brief}
                  onChange={e => setBrief(e.target.value)}
                  placeholder={`Mô tả những gì xảy ra trong tập ${epNumber}. AI sẽ viết kịch bản chi tiết dựa trên nội dung này...`}
                  rows={4}
                  style={{ ...INPUT, resize: 'vertical' }}
                />
              </div>

              {/* Options */}
              <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Hướng video</label>
                  <select
                    value={orientation}
                    onChange={e => setOrientation(e.target.value as 'VERTICAL' | 'HORIZONTAL')}
                    style={{ ...INPUT, cursor: 'pointer' }}
                  >
                    <option value="VERTICAL">Dọc 9:16</option>
                    <option value="HORIZONTAL">Ngang 16:9</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Số cảnh</label>
                  <input
                    type="number" min={3} max={30} value={sceneCount}
                    onChange={e => setSceneCount(Number(e.target.value))}
                    style={INPUT}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Ghi chú style (tùy chọn)
                </label>
                <input
                  value={styleNotes}
                  onChange={e => setStyleNotes(e.target.value)}
                  placeholder="VD: Tông màu ấm, nhấn mạnh cảm xúc nhân vật..."
                  style={INPUT}
                />
              </div>

              {/* Checkboxes */}
              <div className="flex flex-col gap-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeRefs}
                    onChange={e => setIncludeRefs(e.target.checked)}
                  />
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    Tự động tạo ảnh tham chiếu nhân vật còn thiếu
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoReview}
                    onChange={e => setAutoReview(e.target.checked)}
                  />
                  <span className="text-xs" style={{ color: 'var(--muted)' }}>
                    Tự động review chất lượng sau khi gen video (Claude Vision)
                  </span>
                </label>
              </div>

              {/* AI Provider */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  AI viết kịch bản
                </label>
                <AIProviderPicker
                  value={provider}
                  onChange={setProvider}
                  compact
                  label="AI"
                />
              </div>
            </div>
          )}

          {/* RUNNING */}
          {phase === 'running' && jobStatus && (
            <div className="p-6 flex flex-col gap-4">
              {/* Progress header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Loader2 size={14} color="var(--accent)" className="spin" />
                  <span className="text-xs font-semibold" style={{ color: 'var(--accent)' }}>
                    Đang chạy pipeline...
                  </span>
                </div>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  ⏱ {formatTime(elapsedDisplay)}
                </span>
              </div>

              {/* Steps */}
              <div className="flex flex-col gap-2">
                {jobStatus.steps.map(step => (
                  <StepRow
                    key={step.name}
                    step={step}
                    isCurrent={step.name === jobStatus.current_step}
                  />
                ))}
              </div>

              {/* Info note */}
              <div
                className="rounded p-3 text-xs"
                style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--yellow)' }}
              >
                💡 Bước tạo video có thể mất 10-40 phút tùy số cảnh. Bạn có thể đóng modal này — pipeline vẫn chạy trên server.
              </div>
            </div>
          )}

          {/* DONE */}
          {phase === 'done' && jobStatus && (
            <div className="p-6 flex flex-col gap-4">
              {jobStatus.status === 'completed' ? (
                <div
                  className="rounded-xl p-5 flex flex-col gap-3"
                  style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}
                >
                  <div className="flex items-center gap-2">
                    <CheckCircle size={18} color="var(--green)" />
                    <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>
                      Pipeline hoàn thành!
                    </span>
                  </div>
                  <div className="flex gap-4 text-xs" style={{ color: 'var(--muted)' }}>
                    <span>📽️ {jobStatus.scene_count} cảnh</span>
                    <span>⏱ {formatTime(Math.round(jobStatus.elapsed_secs ?? 0))}</span>
                  </div>
                </div>
              ) : (
                <div
                  className="rounded-xl p-5 flex flex-col gap-3"
                  style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)' }}
                >
                  <div className="flex items-center gap-2">
                    <XCircle size={18} color="var(--red)" />
                    <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>
                      {jobStatus.status === 'cancelled' ? 'Pipeline bị hủy' : 'Pipeline thất bại'}
                    </span>
                  </div>
                  {jobStatus.error && (
                    <div className="text-xs" style={{ color: 'var(--red)' }}>{jobStatus.error}</div>
                  )}
                </div>
              )}

              {/* Step summary */}
              <div className="flex flex-col gap-2">
                {jobStatus.steps.map(step => (
                  <StepRow key={step.name} step={step} isCurrent={false} />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div
          className="px-6 py-4 flex justify-between items-center"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          {phase === 'config' && (
            <>
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded text-xs"
                style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                Hủy
              </button>
              <button
                onClick={handleStart}
                disabled={!title.trim() || !brief.trim()}
                className="px-5 py-2 rounded text-xs font-bold flex items-center gap-2"
                style={{
                  background: 'var(--accent)',
                  color: '#fff',
                  opacity: !title.trim() || !brief.trim() ? 0.5 : 1,
                }}
              >
                <Zap size={12} />
                Chạy Auto-Pipeline
              </button>
            </>
          )}

          {phase === 'running' && (
            <>
              <button
                onClick={handleCancel}
                className="px-4 py-2 rounded text-xs"
                style={{ background: 'var(--card)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                Hủy pipeline
              </button>
              <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                <Bot size={12} />
                Pipeline đang chạy tự động...
              </div>
            </>
          )}

          {phase === 'done' && (
            <>
              <button
                onClick={onCancel}
                className="px-4 py-2 rounded text-xs"
                style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                Đóng
              </button>
              <div className="flex gap-2">
                {jobStatus?.status !== 'completed' && (
                  <button
                    onClick={() => setPhase('config')}
                    className="px-4 py-2 rounded text-xs flex items-center gap-1.5"
                    style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                  >
                    <RefreshCw size={11} /> Thử lại
                  </button>
                )}
                {jobStatus?.video_id && (
                  <button
                    onClick={() => onCreated(jobStatus.video_id!)}
                    className="px-5 py-2 rounded text-xs font-bold flex items-center gap-1.5"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    <ExternalLink size={11} /> Mở Pipeline View
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        .spin { animation: spin 1s linear infinite; }
      `}</style>
    </div>
  )
}
