import { useState, useEffect, useRef } from 'react'
import { postAPI, fetchAPI } from '../../api/client'
import type { Project } from '../../types'
import AIProviderPicker from './AIProviderPicker'
import {
  User, MapPin, Sparkles, Box, Pencil, Image as ImageIcon, Film, Mic,
  Bot, AlertTriangle, RefreshCw, CheckCircle,
  Users, Clapperboard, Palette,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────
interface Material { id: string; name: string }

interface EntityInput {
  name: string
  entity_type: 'character' | 'location' | 'creature' | 'visual_asset'
  description: string
  voice_description?: string
}

interface GeneratedScene {
  display_order: number
  prompt: string
  video_prompt: string
  narrator_text: string
  character_names: string[]
}

interface ScriptResult {
  title: string
  description: string
  scenes: GeneratedScene[]
  suggested_characters: EntityInput[]
  production_notes: string
}

type Step = 'info' | 'entities' | 'ai_select' | 'generating' | 'review' | 'creating'

interface Props {
  onCreated: (p: Project) => void
  onCancel: () => void
}

// ── Helpers ────────────────────────────────────────────────
const ENTITY_ICONS: Record<string, React.ReactNode> = {
  character: <User size={12} />, location: <MapPin size={12} />, creature: <Sparkles size={12} />, visual_asset: <Box size={12} />,
}
const ENTITY_LABELS: Record<string, string> = {
  character: 'Nhân vật', location: 'Địa điểm', creature: 'Sinh vật', visual_asset: 'Vật thể',
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
const SELECT: React.CSSProperties = { ...INPUT, cursor: 'pointer' }

// ── Step Indicator ─────────────────────────────────────────
function Steps({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'info', label: 'Kịch bản' },
    { key: 'entities', label: 'Nhân vật' },
    { key: 'ai_select', label: 'Chọn AI' },
    { key: 'generating', label: 'AI viết' },
    { key: 'review', label: 'Xem lại' },
    { key: 'creating', label: 'Tạo' },
  ]
  const idx = steps.findIndex(s => s.key === current)
  return (
    <div className="flex items-center gap-0 px-1">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center">
          <div className="flex flex-col items-center gap-0.5">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: i < idx ? 'var(--green)' : i === idx ? 'var(--accent)' : 'var(--card)',
                color: i <= idx ? '#fff' : 'var(--muted)',
                fontSize: 10,
              }}
            >
              {i < idx ? '✓' : i + 1}
            </div>
            <span style={{ fontSize: 9, color: i === idx ? 'var(--accent)' : 'var(--muted)', whiteSpace: 'nowrap' }}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div style={{ width: 24, height: 1, background: i < idx ? 'var(--green)' : 'var(--border)', margin: '0 2px', marginBottom: 14 }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Scene Preview Card ─────────────────────────────────────
function SceneCard({
  scene, index, onEdit,
}: {
  scene: GeneratedScene
  index: number
  onEdit: (s: GeneratedScene) => void
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div
      className="rounded-lg p-3 flex flex-col gap-2 cursor-pointer"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start gap-2">
        <div
          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
          style={{ background: 'rgba(59,130,246,0.2)', color: 'var(--accent)' }}
        >
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
            {scene.narrator_text.slice(0, 80)}{scene.narrator_text.length > 80 ? '...' : ''}
          </div>
          <div className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>
            {scene.character_names.join(', ') || '—'}
          </div>
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={e => { e.stopPropagation(); onEdit(scene) }}
            className="px-2 py-0.5 rounded text-xs"
            style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
          >
            <Pencil size={11} />
          </button>
          <span style={{ color: 'var(--muted)', fontSize: 10 }}>{expanded ? '▲' : '▼'}</span>
        </div>
      </div>
      {expanded && (
        <div className="flex flex-col gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div>
            <div className="text-xs font-semibold mb-1 flex items-center gap-1" style={{ color: 'var(--accent)' }}><ImageIcon size={10} /> Prompt ảnh</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>{scene.prompt}</div>
          </div>
          <div>
            <div className="text-xs font-semibold mb-1 flex items-center gap-1" style={{ color: 'var(--green)' }}><Film size={10} /> Video prompt</div>
            <div className="text-xs whitespace-pre-wrap" style={{ color: 'var(--muted)' }}>{scene.video_prompt}</div>
          </div>
          <div>
            <div className="text-xs font-semibold mb-1 flex items-center gap-1" style={{ color: '#a855f7' }}><Mic size={10} /> Narrator</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>{scene.narrator_text}</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Edit Scene Modal ───────────────────────────────────────
function EditSceneModal({ scene, onSave, onClose }: {
  scene: GeneratedScene
  onSave: (s: GeneratedScene) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState({ ...scene })
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.8)' }}
    >
      <div className="rounded-xl flex flex-col" style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        width: '90%', maxWidth: 560, maxHeight: '85vh',
      }}>
        <div className="px-5 py-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Chỉnh cảnh {scene.display_order + 1}</div>
          <button onClick={onClose} style={{ color: 'var(--muted)', fontSize: 18 }}>×</button>
        </div>
        <div className="flex-1 overflow-auto p-5 flex flex-col gap-3">
          {[
            { key: 'prompt',        icon: <ImageIcon size={10} />, label: 'Image Prompt',   rows: 3 },
            { key: 'video_prompt',  icon: <Film size={10} />,      label: 'Video Prompt',   rows: 4 },
            { key: 'narrator_text', icon: <Mic size={10} />,       label: 'Narrator Text',  rows: 2 },
          ].map(({ key, icon, label, rows }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--muted)' }}>{icon} {label}</label>
              <textarea
                value={draft[key as keyof GeneratedScene] as string}
                onChange={e => setDraft(prev => ({ ...prev, [key]: e.target.value }))}
                rows={rows}
                style={{ ...INPUT, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
              />
            </div>
          ))}
        </div>
        <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
            Hủy
          </button>
          <button onClick={() => { onSave(draft); onClose() }} className="px-4 py-1.5 rounded text-xs font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>
            Lưu
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────
export default function AIProjectCreator({ onCreated, onCancel }: Props) {
  const [step, setStep] = useState<Step>('info')
  const [materials, setMaterials] = useState<Material[]>([])

  // Step 1: Info
  const [name, setName] = useState('')
  const [story, setStory] = useState('')
  const [material, setMaterial] = useState('realistic')
  const [orientation, setOrientation] = useState<'VERTICAL' | 'HORIZONTAL'>('VERTICAL')
  const [sceneCount, setSceneCount] = useState(10)
  const [inputMode, setInputMode] = useState<'scenes' | 'duration'>('scenes')
  const [durationStr, setDurationStr] = useState('01:20')
  const [language, setLanguage] = useState('vi')
  const [styleNotes, setStyleNotes] = useState('')
  const [provider, setProvider] = useState('auto')  // 'auto'|'claude'|'openai'|'gemini'

  // ── Friendly error parser ────────────────────────────────
  function friendlyError(raw: string): string {
    // Extract inner detail if JSON wrapped
    let msg = raw
    try {
      const m = raw.match(/\{.*\}/s)
      if (m) {
        const parsed = JSON.parse(m[0])
        if (parsed.detail) msg = parsed.detail
      }
    } catch { /* ignore */ }

    // Map to Vietnamese user-friendly messages
    if (msg.includes('invalid x-api-key') || msg.includes('invalid_api_key'))
      return 'API Key không hợp lệ. Vào Cài đặt → API Keys để kiểm tra lại.'
    if (msg.includes('Chưa có') && msg.includes('API Key'))
      return 'Chưa cài API Key. Vào Cài đặt → API Keys để thêm key.'
    if (msg.includes('rate_limit') || msg.includes('rate-limit') || msg.includes('429') || msg.includes('Rate limit'))
      return '⏱ API đang bị rate-limit. Đợi 1-2 phút rồi thử lại, hoặc thêm key khác trong Cài đặt.'
    if (msg.includes('insufficient_quota') || msg.includes('exceeded your current quota'))
      return '💳 Hết quota API. Kiểm tra billing tài khoản hoặc thêm key mới.'
    if (msg.includes('overloaded') || msg.includes('529'))
      return '⏳ Server AI đang quá tải. Đợi vài giây rồi thử lại.'
    if (msg.includes('502') || msg.includes('Bad Gateway'))
      return 'Lỗi kết nối AI (502). Kiểm tra API Key và thử lại.'
    if (msg.includes('timeout') || msg.includes('timed out'))
      return '⏰ Kết nối AI quá thời gian. Kiểm tra internet và thử lại.'
    if (msg.includes('JSON') || msg.includes('json'))
      return 'AI trả về dữ liệu lỗi định dạng. Hãy thử lại.'
    // Return cleaned message
    return msg.replace(/^API \d+: /, '')
  }

  // Step 2: Entities
  const [entities, setEntities] = useState<EntityInput[]>([
    { name: '', entity_type: 'character', description: '' },
  ])

  // Step 3+4: AI result
  const [genLog, setGenLog] = useState<string[]>([])
  const [script, setScript] = useState<ScriptResult | null>(null)
  const [editingScene, setEditingScene] = useState<GeneratedScene | null>(null)

  // Step 5: Creating
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')

  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Load materials + settings defaults in parallel
    Promise.all([
      fetchAPI<Material[]>('/api/materials').catch(() => [] as Material[]),
      fetchAPI<Record<string, unknown>>('/api/settings').catch(() => ({} as Record<string, unknown>)),
    ]).then(([mats, s]) => {
      if (mats.length > 0) setMaterials(mats)
      // Apply saved defaults
      if (s.defaultMaterial) setMaterial(s.defaultMaterial as string)

      const formatSecondsToTime = (totalSeconds: number): string => {
        const mins = Math.floor(totalSeconds / 60)
        const secs = totalSeconds % 60
        const minsStr = mins.toString().padStart(2, '0')
        const secsStr = secs.toString().padStart(2, '0')
        return `${minsStr}:${secsStr}`
      }

      if (s.defaultOrientation) setOrientation(s.defaultOrientation as 'VERTICAL' | 'HORIZONTAL')
      if (s.defaultSceneCount) {
        const count = Number(s.defaultSceneCount)
        setSceneCount(count)
        setDurationStr(formatSecondsToTime(count * 8))
      }
    })
  }, [])

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [genLog])

  function addLog(msg: string) {
    setGenLog(prev => [...prev, `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`])
  }

  // ── Generate Script ──────────────────────────────────────
  async function handleGenerate() {
    setStep('generating')
    setGenLog([])
    setError('')

    const validEntities = entities.filter(e => e.name.trim())

    const providerLabel = provider === 'auto' ? 'AI mặc định' : provider
    addLog(`🤖 Đang kết nối ${providerLabel}...`)
    addLog(`📝 Phân tích câu chuyện: "${name}"`)
    addLog(`🎨 Style: ${material} | ${orientation} | ${sceneCount} cảnh`)
    if (validEntities.length > 0) {
      addLog(`👥 ${validEntities.length} nhân vật/địa điểm được đưa vào context`)
    }
    addLog(`⏳ ${providerLabel} đang viết kịch bản... (10-30 giây)`)

    try {
      const result = await postAPI<ScriptResult>('/api/ai/generate-script', {
        name,
        story,
        material,
        orientation,
        scene_count: sceneCount,
        language,
        characters: validEntities,
        style_notes: styleNotes || undefined,
        provider: provider === 'auto' ? undefined : provider,
      })

      addLog(`✅ Tạo thành công ${result.scenes.length} cảnh!`)
      if (result.suggested_characters.length > 0) {
        addLog(`💡 Claude đề xuất thêm ${result.suggested_characters.length} nhân vật`)
      }
      if (result.production_notes) {
        addLog(`📋 Ghi chú: ${result.production_notes}`)
      }

      // Auto-add suggested characters
      if (result.suggested_characters.length > 0) {
        setEntities(prev => {
          const existing = new Set(prev.map(e => e.name.toLowerCase()))
          const toAdd = result.suggested_characters.filter(c => !existing.has(c.name.toLowerCase()))
          return [...prev, ...toAdd]
        })
      }

      setScript(result)
      setStep('review')
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e)
      const msg = friendlyError(raw)
      addLog(`❌ ${msg}`)
      setError(msg)
      setStep('ai_select')  // Go back to ai_select so user can retry
    } finally {}
  }

  // ── Create Project ───────────────────────────────────────
  async function handleCreate() {
    if (!script) return
    setStep('creating')
    setCreating(true)
    setError('')

    try {
      const validEntities = entities.filter(e => e.name.trim())

      // 1. Tạo project
      const project = await postAPI<Project>('/api/projects', {
        name,
        story,
        material,
        language,
        characters: validEntities.map(e => ({
          name: e.name.trim(),
          entity_type: e.entity_type,
          description: e.description.trim() || undefined,
          voice_description: e.voice_description?.trim() || undefined,
        })),
      })

      // 2. Tạo video
      const video = await postAPI<{ id: string; project_id: string }>('/api/videos', {
        project_id: project.id,
        title: script.title || name,
        description: script.description,
        orientation,
        display_order: 0,
      })

      // 3. Tạo scenes từ AI script
      for (let i = 0; i < script.scenes.length; i++) {
        const s = script.scenes[i]
        await postAPI('/api/scenes', {
          video_id: video.id,
          display_order: s.display_order,
          chain_type: i === 0 ? 'ROOT' : 'CONTINUATION',
          prompt: s.prompt,
          video_prompt: s.video_prompt,
          narrator_text: s.narrator_text,
          character_names: s.character_names.length > 0 ? s.character_names : undefined,
        })
      }

      // 4. Set active project
      await postAPI('/api/active-project', { project_id: project.id }).catch(() =>
        fetch('http://127.0.0.1:8100/api/active-project', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project_id: project.id }),
        })
      )

      onCreated(project)
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e)
      setError(friendlyError(raw))
      setStep('review')
    } finally {
      setCreating(false)
    }
  }

  // ── Render ───────────────────────────────────────────────
  return (
    <>
      {editingScene && (
        <EditSceneModal
          scene={editingScene}
          onSave={updated => {
            setScript(prev => prev ? {
              ...prev,
              scenes: prev.scenes.map(s => s.display_order === updated.display_order ? updated : s)
            } : prev)
          }}
          onClose={() => setEditingScene(null)}
        />
      )}

      <div
        className="fixed inset-0 z-40 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      >
        <div className="rounded-2xl flex flex-col" style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          width: '95%', maxWidth: 640, maxHeight: '90vh',
        }}>
          {/* Header */}
          <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Bot size={20} style={{ color: 'var(--accent)' }} />
                <div>
                  <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Tạo dự án với AI</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>Claude sẽ viết toàn bộ kịch bản cho bạn</div>
                </div>
              </div>
              {step !== 'creating' && step !== 'generating' && (
                <button onClick={onCancel} style={{ color: 'var(--muted)', fontSize: 18 }}>×</button>
              )}
            </div>
            <Steps current={step} />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto">

            {/* STEP 1: Info */}
            {step === 'info' && (
              <div className="p-6 flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tên dự án *</label>
                  <input
                    autoFocus
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="VD: Chiến tranh Lạnh — Bí mật CIA"
                    style={INPUT}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    Câu chuyện / Kịch bản *
                  </label>
                  <textarea
                    value={story}
                    onChange={e => setStory(e.target.value)}
                    placeholder="Mô tả chi tiết nội dung video. Claude sẽ dựa vào đây để viết kịch bản cho từng cảnh...

Ví dụ: Đây là series tài liệu về cuộc Chiến tranh Lạnh (1947-1991). Tập này kể về cuộc chạy đua hạt nhân giữa Mỹ và Liên Xô, từ vụ thử bom nguyên tử đầu tiên của Liên Xô năm 1949 đến Khủng hoảng Tên lửa Cuba năm 1962..."
                    rows={5}
                    style={{ ...INPUT, resize: 'vertical' }}
                  />
                </div>

                <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Visual Style</label>
                    <select value={material} onChange={e => setMaterial(e.target.value)} style={SELECT}>
                      {materials.length > 0 ? materials.map(m => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      )) : (
                        <>
                          <option value="realistic">Photorealistic</option>
                          <option value="3d_pixar">3D Pixar</option>
                          <option value="anime">Anime</option>
                          <option value="ghibli">Studio Ghibli</option>
                        </>
                      )}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Hướng video</label>
                    <select value={orientation} onChange={e => setOrientation(e.target.value as 'VERTICAL' | 'HORIZONTAL')} style={SELECT}>
                      <option value="VERTICAL">Dọc 9:16 (Shorts)</option>
                      <option value="HORIZONTAL">Ngang 16:9 (YouTube)</option>
                    </select>
                  </div>
                  <div
                    className="flex flex-col gap-4 p-4 rounded-xl flex-1 col-span-2"
                    style={{
                      background: 'rgba(255, 255, 255, 0.01)',
                      border: '1px solid var(--border)',
                      boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.03)',
                    }}
                  >
                    {/* Header with Segmented Control */}
                    <div className="flex flex-col gap-2">
                      <label className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                        Định dạng thời lượng video
                      </label>
                      <div
                        className="flex rounded-lg p-1 w-full"
                        style={{
                          background: 'var(--surface)',
                          border: '1px solid var(--border)',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => setInputMode('scenes')}
                          className="flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-all"
                          style={{
                            background: inputMode === 'scenes' ? 'var(--accent)' : 'transparent',
                            color: inputMode === 'scenes' ? '#fff' : 'var(--muted)',
                            boxShadow: inputMode === 'scenes' ? '0 2px 4px rgba(124,91,245,0.2)' : 'none',
                            border: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          <Clapperboard size={12} />
                          Số phân cảnh
                        </button>
                        <button
                          type="button"
                          onClick={() => setInputMode('duration')}
                          className="flex-1 py-1.5 text-xs font-semibold rounded-md flex items-center justify-center gap-1.5 transition-all"
                          style={{
                            background: inputMode === 'duration' ? 'var(--accent)' : 'transparent',
                            color: inputMode === 'duration' ? '#fff' : 'var(--muted)',
                            boxShadow: inputMode === 'duration' ? '0 2px 4px rgba(124,91,245,0.2)' : 'none',
                            border: 'none',
                            cursor: 'pointer'
                          }}
                        >
                          <Film size={12} />
                          Thời lượng mong muốn
                        </button>
                      </div>
                    </div>

                    {/* Input Field based on Mode */}
                    {inputMode === 'scenes' ? (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                            Số phân cảnh cần tạo
                          </label>
                          <span className="text-[10px] uppercase font-bold" style={{ color: 'var(--accent)' }}>
                            8 giây / cảnh
                          </span>
                        </div>
                        <input
                          type="number"
                          min={3}
                          max={30}
                          value={sceneCount}
                          onChange={e => {
                            const val = Number(e.target.value)
                            setSceneCount(val)
                            const formatSecondsToTime = (totalSeconds: number): string => {
                              const mins = Math.floor(totalSeconds / 60)
                              const secs = totalSeconds % 60
                              const minsStr = mins.toString().padStart(2, '0')
                              const secsStr = secs.toString().padStart(2, '0')
                              return `${minsStr}:${secsStr}`
                            }
                            setDurationStr(formatSecondsToTime(val * 8))
                          }}
                          style={INPUT}
                        />
                        <div
                          className="text-xs p-2.5 rounded-lg flex items-center gap-2"
                          style={{
                            background: 'rgba(124,91,245,0.06)',
                            border: '1px solid rgba(124,91,245,0.15)',
                            color: 'var(--muted)'
                          }}
                        >
                          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--accent)' }}></span>
                          <span>
                            Thời lượng ước tính: <strong style={{ color: 'var(--text)', fontSize: '13px' }}>{sceneCount * 8}s</strong> (~{Math.floor(sceneCount * 8 / 60)}m {sceneCount * 8 % 60}s)
                          </span>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                            Thời lượng mong muốn (mm:ss)
                          </label>
                          <span className="text-[10px] uppercase font-bold" style={{ color: 'var(--yellow)' }}>
                            Quy đổi 8 giây / cảnh
                          </span>
                        </div>
                        <input
                          type="text"
                          placeholder="VD: 01:20"
                          value={durationStr}
                          onChange={e => {
                            const val = e.target.value
                            setDurationStr(val)
                            const parseTimeToSeconds = (str: string): number => {
                              if (!str) return 0
                              const parts = str.split(':')
                              if (parts.length === 2) {
                                const mins = parseInt(parts[0], 10) || 0
                                const secs = parseInt(parts[1], 10) || 0
                                return mins * 60 + secs
                              }
                              const secs = parseInt(str, 10) || 0
                              return secs
                            }
                            const totalSecs = parseTimeToSeconds(val)
                            const calculated = Math.max(3, Math.round(totalSecs / 8))
                            setSceneCount(calculated)
                          }}
                          style={INPUT}
                        />
                        <div
                          className="text-xs p-2.5 rounded-lg flex items-center gap-2"
                          style={{
                            background: 'rgba(245,158,11,0.06)',
                            border: '1px solid rgba(245,158,11,0.15)',
                            color: 'var(--muted)'
                          }}
                        >
                          <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: 'var(--yellow)' }}></span>
                          <span>
                            Tự động quy đổi thành: <strong style={{ color: 'var(--text)', fontSize: '13px' }}>{sceneCount}</strong> phân cảnh tương ứng
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ngôn ngữ</label>
                    <select value={language} onChange={e => setLanguage(e.target.value)} style={SELECT}>
                      <option value="vi">Tiếng Việt</option>
                      <option value="en">Tiếng Anh</option>
                      <option value="ja">Tiếng Nhật</option>
                      <option value="ko">Tiếng Hàn</option>
                      <option value="es">Tiếng Tây Ban Nha</option>
                      <option value="fr">Tiếng Pháp</option>
                      <option value="pt">Tiếng Bồ Đào Nha</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ghi chú phong cách</label>
                    <input value={styleNotes} onChange={e => setStyleNotes(e.target.value)} placeholder="VD: Tone tối, dramatic..." style={INPUT} />
                  </div>
                </div>

                <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', color: 'var(--muted)' }}>
                  💡 <strong style={{ color: 'var(--accent)' }}>Tip:</strong> Câu chuyện càng chi tiết, AI viết kịch bản càng tốt. Thêm thông tin về: nhân vật chính, bối cảnh lịch sử, sự kiện quan trọng, cảm xúc muốn truyền đạt.
                </div>
              </div>
            )}

            {/* STEP 2: Entities */}
            {step === 'entities' && (
              <div className="p-6 flex flex-col gap-4">
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  Thêm nhân vật, địa điểm, vật thể. Claude sẽ tự động đề xuất thêm sau khi phân tích kịch bản.
                  <span style={{ color: 'var(--accent)' }}> (Có thể bỏ qua — để trống AI tự đề xuất)</span>
                </div>

                <div className="flex flex-col gap-2">
                  {entities.map((e, i) => (
                    <div key={i} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                      <div className="flex gap-2 items-center">
                        <select
                          value={e.entity_type}
                          onChange={ev => setEntities(prev => prev.map((x, xi) => xi === i ? { ...x, entity_type: ev.target.value as EntityInput['entity_type'] } : x))}
                          style={{ ...SELECT, width: 'auto', flexShrink: 0 }}
                        >
                          {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                            <option key={k} value={k}>{ENTITY_ICONS[k]} {v}</option>
                          ))}
                        </select>
                        <input
                          value={e.name}
                          onChange={ev => setEntities(prev => prev.map((x, xi) => xi === i ? { ...x, name: ev.target.value } : x))}
                          placeholder="Tên *"
                          style={{ ...INPUT, flex: 1 }}
                        />
                        <button
                          onClick={() => setEntities(prev => prev.filter((_, xi) => xi !== i))}
                          style={{ color: 'var(--red)', flexShrink: 0, fontSize: 16 }}
                        >×</button>
                      </div>
                      <textarea
                        value={e.description}
                        onChange={ev => setEntities(prev => prev.map((x, xi) => xi === i ? { ...x, description: ev.target.value } : x))}
                        placeholder="Mô tả ngoại hình chi tiết (giúp AI viết prompt chính xác hơn)"
                        rows={2}
                        style={{ ...INPUT, resize: 'none', fontSize: 11 }}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 flex-wrap">
                  {Object.entries(ENTITY_LABELS).map(([k, v]) => (
                    <button
                      key={k}
                      onClick={() => setEntities(prev => [...prev, { name: '', entity_type: k as EntityInput['entity_type'], description: '' }])}
                      className="px-2.5 py-1 rounded text-xs"
                      style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                    >
                      + {ENTITY_ICONS[k]} {v}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {/* STEP 2.5: Chọn AI */}
            {step === 'ai_select' && (
              <div className="p-6 flex flex-col gap-5">

                {/* Tóm tắt */}
                <div className="rounded-lg p-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                  <div className="text-xs font-bold mb-2" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Tóm tắt dự án</div>
                  <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>{name}</div>
                  <div className="text-xs mt-1" style={{ color: 'var(--muted)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {story}
                  </div>
                  <div className="flex gap-3 mt-2.5 flex-wrap">
                    {[
                      { icon: <Palette size={10} />, label: material },
                      { icon: orientation === 'VERTICAL' ? '📱' : '💻', label: orientation === 'VERTICAL' ? 'Dọc 9:16' : 'Ngang 16:9' },
                      { icon: <Clapperboard size={10} />, label: `${sceneCount} cảnh` },
                      { icon: <Users size={10} />, label: `${entities.filter(e => e.name.trim()).length} nhân vật` },
                    ].map(b => (
                      <span key={b.label} className="text-xs px-2 py-0.5 rounded-full"
                        style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
                        {b.icon} {b.label}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Provider picker */}
                <div>
                  <div className="text-xs font-bold mb-3" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    Chọn AI viết kịch bản
                  </div>
                  <AIProviderPicker value={provider} onChange={setProvider} />
                </div>

                {/* Error from previous attempt */}
                {error && (
                  <div className="rounded-lg p-4 flex flex-col gap-2"
                    style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                    <div className="flex items-center gap-2">
                      <AlertTriangle size={15} style={{ color: 'var(--yellow)', flexShrink: 0 }} />
                      <span className="text-xs font-bold" style={{ color: '#ef4444' }}>Lỗi lần trước — hãy kiểm tra lại</span>
                    </div>
                    <div className="text-xs" style={{ color: '#f87171' }}>{error}</div>
                    <div className="text-xs" style={{ color: 'var(--muted)' }}>
                      Vào <strong>Cài đặt → API Keys</strong> để kiểm tra, hoặc chọn AI khác rồi thử lại.
                    </div>
                  </div>
                )}

                {/* Generate button */}
                <button
                  onClick={() => { setError(''); handleGenerate() }}
                  className="w-full py-3 rounded-xl font-bold text-sm flex items-center justify-center gap-2"
                  style={{
                    background: 'linear-gradient(135deg, var(--accent) 0%, #8b5cf6 100%)',
                    color: '#fff',
                    boxShadow: '0 4px 20px rgba(124,91,245,0.3)',
                  }}
                >
                  <Bot size={20} style={{ color: 'var(--accent)' }} />
                  {provider === 'auto' ? 'Bắt đầu viết kịch bản' : `${provider.charAt(0).toUpperCase() + provider.slice(1)} viết kịch bản`}
                </button>
              </div>
            )}

            {/* STEP 3: Generating */}
            {step === 'generating' && (
              <div className="p-6 flex flex-col gap-4">
                <div className="flex flex-col items-center gap-3 py-4">
                  <Bot size={40} style={{ color: 'var(--accent)' }} />
                  <div className="font-bold" style={{ color: 'var(--text)' }}>
                    {provider === 'auto' ? 'AI mặc định' : provider} đang viết kịch bản...
                  </div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>Thường mất 15-30 giây</div>

                  {/* Animated bars */}
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div
                        key={i}
                        style={{
                          width: 4, height: 20, borderRadius: 2,
                          background: 'var(--accent)',
                          animation: `pulse 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
                          opacity: 0.6,
                        }}
                      />
                    ))}
                  </div>
                </div>

                <div
                  ref={logRef}
                  className="rounded-lg p-3"
                  style={{ background: '#080810', border: '1px solid var(--border)', fontFamily: 'monospace', fontSize: 11, maxHeight: 200, overflowY: 'auto' }}
                >
                  {genLog.map((line, i) => (
                    <div key={i} style={{ color: line.includes('❌') ? 'var(--red)' : line.includes('✅') ? 'var(--green)' : 'var(--muted)' }}>
                      {line}
                    </div>
                  ))}
                </div>

                {error && (
                  <div className="rounded p-3 text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                    <div className="font-bold mb-1 flex items-center gap-1.5"><AlertTriangle size={13} style={{ color: 'var(--red)' }} /> Đã xảy ra lỗi</div>
                    <div>{error}</div>
                    <button
                      onClick={() => { setStep('ai_select') }}
                      className="mt-2 px-3 py-1 rounded text-xs font-bold"
                      style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)' }}
                    >
                      ← Quay lại chọn AI
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* STEP 4: Review */}
            {step === 'review' && script && (
              <div className="p-6 flex flex-col gap-4">
                {/* Summary */}
                <div className="rounded-lg p-4 flex flex-col gap-2" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
                  <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>"{script.title}"</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{script.description}</div>
                  <div className="flex gap-3 text-xs mt-1">
                    <span className="flex items-center gap-1" style={{ color: 'var(--accent)' }}><Clapperboard size={10} /> {script.scenes.length} cảnh</span>
                    <span className="flex items-center gap-1" style={{ color: 'var(--green)' }}><Users size={10} /> {entities.filter(e => e.name).length} nhân vật</span>
                    {script.production_notes && (
                      <span style={{ color: 'var(--yellow)' }}>📋 Có ghi chú</span>
                    )}
                  </div>
                  {script.production_notes && (
                    <div className="text-xs mt-1 p-2 rounded" style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--yellow)', border: '1px solid rgba(245,158,11,0.2)' }}>
                      {script.production_notes}
                    </div>
                  )}
                </div>

                {/* Scenes list */}
                <div className="flex flex-col gap-2">
                  <div className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: 1 }}>
                    Kịch bản ({script.scenes.length} cảnh) — Click để xem chi tiết
                  </div>
                  {script.scenes.map((s, i) => (
                    <SceneCard
                      key={s.display_order}
                      scene={s}
                      index={i}
                      onEdit={setEditingScene}
                    />
                  ))}
                </div>

                {/* Regenerate option */}
                <button
                  onClick={handleGenerate}
                  className="text-xs text-center"
                  style={{ color: 'var(--muted)' }}
                >
                  <RefreshCw size={13} /> Không hài lòng? Tạo lại kịch bản
                </button>

                {error && (
                  <div className="rounded p-3 text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* STEP 5: Creating */}
            {step === 'creating' && (
              <div className="p-6 flex flex-col items-center gap-4 py-10">
                <div style={{ fontSize: 40 }}>⚙️</div>
                <div className="font-bold" style={{ color: 'var(--text)' }}>Đang tạo dự án...</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  Tạo project → Tạo video → Tạo {script?.scenes.length} cảnh
                </div>
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div
                      key={i}
                      style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: 'var(--accent)',
                        animation: `pulse 0.6s ease-in-out ${i * 0.2}s infinite alternate`,
                      }}
                    />
                  ))}
                </div>
                {error && (
                  <div className="rounded p-3 text-xs w-full" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                    {error}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {step !== 'generating' && step !== 'creating' && (
            <div className="px-6 py-4 flex justify-between items-center" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => {
                  if (step === 'info') onCancel()
                  else if (step === 'entities') setStep('info')
                  else if (step === 'ai_select') { setError(''); setStep('entities') }
                  else if (step === 'review') setStep('ai_select')
                }}
                className="px-4 py-2 rounded text-xs"
                style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                {step === 'info' ? 'Hủy' : '← Quay lại'}
              </button>

              <div className="flex gap-2">
                {step === 'info' && (
                  <button
                    onClick={() => setStep('entities')}
                    disabled={!name.trim() || !story.trim()}
                    className="px-4 py-2 rounded text-xs font-bold"
                    style={{ background: 'var(--accent)', color: '#fff', opacity: (!name.trim() || !story.trim()) ? 0.5 : 1 }}
                  >
                    Tiếp theo →
                  </button>
                )}
                {step === 'entities' && (
                  <button
                    onClick={() => setStep('ai_select')}
                    className="px-5 py-2 rounded text-xs font-bold flex items-center gap-2"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    Tiếp theo →
                  </button>
                )}
                {step === 'review' && script && (
                  <button
                    onClick={handleCreate}
                    disabled={creating}
                    className="px-5 py-2 rounded text-xs font-bold"
                    style={{ background: 'var(--green)', color: '#fff', opacity: creating ? 0.6 : 1 }}
                  >
                    <CheckCircle size={14} /> Tạo dự án ngay
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          from { transform: scaleY(0.4); opacity: 0.5; }
          to { transform: scaleY(1); opacity: 1; }
        }
      `}</style>
    </>
  )
}
