import { useState, useEffect, useRef } from 'react'
import { postAPI } from '../../api/client'
import type { Video, Character, Project } from '../../types'
import AIProviderPicker from './AIProviderPicker'
import {
  Pencil, Image as ImageIcon, Film, Mic, Bot, Folder, Users,
  Clapperboard, Palette, Link2, RefreshCw, CheckCircle, Settings2,
} from 'lucide-react'

// ── Types ──────────────────────────────────────────────────
interface GeneratedScene {
  display_order: number
  prompt: string
  video_prompt: string
  narrator_text: string
  character_names: string[]
}

interface EpisodeResult {
  title: string
  description: string
  scenes: GeneratedScene[]
  continuity_notes: string
}

type Step = 'setup' | 'generating' | 'review' | 'creating'

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

// ── Scene Preview ──────────────────────────────────────────
function ScenePreview({ scene, index, onEdit }: {
  scene: GeneratedScene
  index: number
  onEdit: (s: GeneratedScene) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div
      className="rounded-lg p-3 cursor-pointer"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      onClick={() => setOpen(!open)}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: 'var(--accent-glow)', color: 'var(--accent)' }}
        >
          {index + 1}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs truncate" style={{ color: 'var(--text)' }}>
            {scene.narrator_text.slice(0, 90) || scene.prompt.slice(0, 90)}
          </div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {scene.character_names.join(', ') || '—'}
          </div>
        </div>
        <button
          onClick={e => { e.stopPropagation(); onEdit(scene) }}
          className="text-xs px-2 py-0.5 rounded flex-shrink-0"
          style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        ><Pencil size={10} /></button>
        <span style={{ color: 'var(--muted)', fontSize: 10, flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div className="mt-2 pt-2 flex flex-col gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-xs flex items-center gap-1" style={{ color: 'var(--accent)' }}><ImageIcon size={9} /> {scene.prompt.slice(0, 200)}</div>
          <div className="text-xs whitespace-pre-wrap font-mono" style={{ color: 'var(--muted)', fontSize: 10 }}>
            <Film size={9} style={{ display: 'inline', marginRight: 3 }} />{scene.video_prompt.slice(0, 300)}
          </div>
          <div className="text-xs flex items-center gap-1" style={{ color: 'var(--purple)' }}><Mic size={9} /> {scene.narrator_text}</div>
        </div>
      )}
    </div>
  )
}

// ── Edit Scene ─────────────────────────────────────────────
function EditSceneModal({ scene, onSave, onClose }: {
  scene: GeneratedScene
  onSave: (s: GeneratedScene) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState({ ...scene })
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.85)' }}
    >
      <div className="rounded-xl flex flex-col" style={{ background: 'var(--surface)', border: '1px solid var(--border)', width: '90%', maxWidth: 540, maxHeight: '85vh' }}>
        <div className="px-5 py-4 flex justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>Cảnh {scene.display_order + 1}</span>
          <button onClick={onClose} style={{ color: 'var(--muted)', fontSize: 18 }}>×</button>
        </div>
        <div className="flex-1 overflow-auto p-5 flex flex-col gap-3">
          {[
            { key: 'prompt',        icon: <ImageIcon size={10} />, label: 'Image Prompt',  rows: 3 },
            { key: 'video_prompt',  icon: <Film size={10} />,      label: 'Video Prompt',  rows: 4 },
            { key: 'narrator_text', icon: <Mic size={10} />,       label: 'Narrator',      rows: 2 },
          ].map(({ key, icon, label, rows }) => (
            <div key={key} className="flex flex-col gap-1">
              <label className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--muted)' }}>{icon} {label}</label>
              <textarea
                value={draft[key as keyof GeneratedScene] as string}
                onChange={e => setDraft(p => ({ ...p, [key]: e.target.value }))}
                rows={rows}
                style={{ ...INPUT, resize: 'vertical', fontFamily: 'monospace', fontSize: 11 }}
              />
            </div>
          ))}
        </div>
        <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose} className="px-3 py-1.5 rounded text-xs" style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}>Hủy</button>
          <button onClick={() => { onSave(draft); onClose() }} className="px-4 py-1.5 rounded text-xs font-bold" style={{ background: 'var(--accent)', color: '#fff' }}>Lưu</button>
        </div>
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────
export default function AIEpisodeCreator({ project, characters, existingVideos, onCreated, onCancel }: Props) {
  const [step, setStep] = useState<Step>('setup')

  const [episodeTitle, setEpisodeTitle] = useState('')
  const [episodeBrief, setEpisodeBrief] = useState('')
  const [sceneCount, setSceneCount] = useState(10)
  const [orientation, setOrientation] = useState<'VERTICAL' | 'HORIZONTAL'>(
    (existingVideos[0]?.orientation as 'VERTICAL' | 'HORIZONTAL') ?? 'VERTICAL'
  )
  const [styleNotes, setStyleNotes] = useState('')
  const [includeContext, setIncludeContext] = useState(true)
  const [provider, setProvider] = useState('auto')

  const [genLog, setGenLog] = useState<string[]>([])
  const [result, setResult] = useState<EpisodeResult | null>(null)
  const [editingScene, setEditingScene] = useState<GeneratedScene | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const episodeNumber = existingVideos.length + 1

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [genLog])

  function addLog(msg: string) {
    setGenLog(prev => [...prev, `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`])
  }

  async function handleGenerate() {
    setStep('generating')
    setGenLog([])
    setError('')

    const providerLabel = provider === 'auto' ? 'AI mặc định' : provider
    addLog(`🤖 ${providerLabel} đang tạo kịch bản Tập ${episodeNumber}...`)
    addLog(`📖 Phân tích story gốc: "${project.name}"`)
    addLog(`👥 ${characters.length} nhân vật trong project`)
    if (includeContext && existingVideos.length > 0) {
      addLog(`🔗 Kế thừa context từ ${existingVideos.length} tập trước`)
    }
    addLog('⏳ Đang xử lý... (15-30 giây)')

    try {
      const previousEpisodes = includeContext ? existingVideos.slice(-3).map((v, i) => ({
        number: i + 1,
        title: v.title,
        description: v.description || '',
      })) : []

      const data = await postAPI<EpisodeResult>('/api/ai/generate-episode', {
        project_id: project.id,
        project_name: project.name,
        project_story: project.story || '',
        project_material: project.material || 'realistic',
        characters: characters.map(c => ({
          name: c.name,
          entity_type: c.entity_type,
          description: c.description || '',
        })),
        episode_number: episodeNumber,
        episode_title: episodeTitle,
        episode_brief: episodeBrief,
        scene_count: sceneCount,
        orientation,
        language: 'vi',
        style_notes: styleNotes || undefined,
        previous_episodes: previousEpisodes.length > 0 ? previousEpisodes : undefined,
        provider: provider === 'auto' ? undefined : provider,
      })

      addLog(`✅ Tạo thành công ${data.scenes.length} cảnh!`)
      if (data.continuity_notes) {
        addLog(`🔗 Continuity: ${data.continuity_notes.slice(0, 80)}...`)
      }
      setResult(data)
      setStep('review')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      addLog(`❌ Lỗi: ${msg}`)
      setError(msg)
    }
  }

  async function handleCreate() {
    if (!result) return
    setStep('creating')
    setCreating(true)
    setError('')

    try {
      const video = await postAPI<{ id: string }>('/api/videos', {
        project_id: project.id,
        title: result.title || `Tập ${episodeNumber}: ${episodeTitle}`,
        description: result.description || episodeBrief,
        orientation,
        display_order: existingVideos.length,
      })

      for (let i = 0; i < result.scenes.length; i++) {
        const s = result.scenes[i]
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

      onCreated(video.id)
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setStep('review')
    } finally {
      setCreating(false)
    }
  }

  const stepsInfo = [
    { key: 'setup', label: 'Nội dung' },
    { key: 'generating', label: 'AI viết' },
    { key: 'review', label: 'Xem lại' },
    { key: 'creating', label: 'Tạo' },
  ]
  const stepIdx = stepsInfo.findIndex(s => s.key === step)

  return (
    <>
      {editingScene && (
        <EditSceneModal
          scene={editingScene}
          onSave={updated => {
            setResult(prev => prev ? {
              ...prev,
              scenes: prev.scenes.map(s => s.display_order === updated.display_order ? updated : s),
            } : prev)
          }}
          onClose={() => setEditingScene(null)}
        />
      )}

      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      >
        <div className="rounded-2xl flex flex-col" style={{
          background: 'var(--surface)', border: '1px solid var(--border)',
          width: '95%', maxWidth: 620, maxHeight: '90vh',
        }}>
          {/* Header */}
          <div className="px-6 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <Bot size={18} style={{ color: 'var(--accent)' }} />
                  <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>
                    Tạo Tập {episodeNumber} — AI
                  </span>
                </div>
                <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {project.name} • {characters.length} nhân vật
                </div>
              </div>
              {!creating && step !== 'generating' && (
                <button onClick={onCancel} style={{ color: 'var(--muted)', fontSize: 18 }}>×</button>
              )}
            </div>

            {/* Steps */}
            <div className="flex items-center gap-0">
              {stepsInfo.map((s, i) => (
                <div key={s.key} className="flex items-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold"
                      style={{
                        background: i < stepIdx ? 'var(--green)' : i === stepIdx ? 'var(--accent)' : 'var(--card)',
                        color: i <= stepIdx ? '#fff' : 'var(--muted)',
                        fontSize: 9,
                      }}
                    >
                      {i < stepIdx ? '✓' : i + 1}
                    </div>
                    <span style={{ fontSize: 9, color: i === stepIdx ? 'var(--accent)' : 'var(--muted)' }}>{s.label}</span>
                  </div>
                  {i < stepsInfo.length - 1 && (
                    <div style={{ width: 20, height: 1, background: i < stepIdx ? 'var(--green)' : 'var(--border)', margin: '0 2px', marginBottom: 14 }} />
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto">

            {/* SETUP */}
            {step === 'setup' && (
              <div className="p-6 flex flex-col gap-4">
                {/* Project context */}
                <div className="rounded-lg p-3" style={{ background: 'var(--accent-subtle)', border: '1px solid var(--accent-glow)' }}>
                  <div className="text-xs font-semibold mb-1 flex items-center gap-1" style={{ color: 'var(--accent)' }}><Folder size={10} /> Project gốc</div>
                  <div className="text-xs font-bold" style={{ color: 'var(--text)' }}>{project.name}</div>
                  {project.story && (
                    <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                      {project.story.slice(0, 150)}{project.story.length > 150 ? '...' : ''}
                    </div>
                  )}
                  <div className="flex gap-2 mt-2 text-xs" style={{ color: 'var(--muted)' }}>
                    <span className="flex items-center gap-1"><Users size={9} /> {characters.length} nhân vật</span>
                    <span className="flex items-center gap-1"><Clapperboard size={9} /> {existingVideos.length} tập đã có</span>
                    <span className="flex items-center gap-1"><Palette size={9} /> {project.material}</span>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tên tập {episodeNumber} *</label>
                  <input
                    autoFocus
                    value={episodeTitle}
                    onChange={e => setEpisodeTitle(e.target.value)}
                    placeholder={`VD: Tập ${episodeNumber} — Cuộc phản công`}
                    style={INPUT}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Nội dung tập này *</label>
                  <textarea
                    value={episodeBrief}
                    onChange={e => setEpisodeBrief(e.target.value)}
                    placeholder={`Mô tả chi tiết những gì xảy ra trong tập ${episodeNumber}. Claude sẽ viết kịch bản bám sát nội dung này và đảm bảo liên tục với các tập trước...`}
                    rows={4}
                    style={{ ...INPUT, resize: 'vertical' }}
                  />
                </div>

                <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Hướng video</label>
                    <select value={orientation} onChange={e => setOrientation(e.target.value as 'VERTICAL' | 'HORIZONTAL')} style={{ ...INPUT, cursor: 'pointer' }}>
                      <option value="VERTICAL">Dọc 9:16</option>
                      <option value="HORIZONTAL">Ngang 16:9</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Số cảnh</label>
                    <input type="number" min={3} max={30} value={sceneCount} onChange={e => setSceneCount(Number(e.target.value))} style={INPUT} />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Ghi chú</label>
                    <input value={styleNotes} onChange={e => setStyleNotes(e.target.value)} placeholder="Tone, style..." style={INPUT} />
                  </div>
                </div>

                {existingVideos.length > 0 && (
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={includeContext}
                      onChange={e => setIncludeContext(e.target.checked)}
                    />
                    <span className="text-xs" style={{ color: 'var(--muted)' }}>
                      Đưa context {existingVideos.length} tập trước vào prompt AI (đảm bảo liên tục)
                    </span>
                  </label>
                )}

                <AIProviderPicker
                  value={provider}
                  onChange={setProvider}
                  label="AI viết kịch bản"
                />
              </div>
            )}

            {/* GENERATING */}
            {step === 'generating' && (
              <div className="p-6 flex flex-col gap-4">
                <div className="flex flex-col items-center gap-3 py-4">
                  <Bot size={36} style={{ color: 'var(--accent)' }} />
                  <div className="font-bold" style={{ color: 'var(--text)' }}>
                    {provider === 'auto' ? 'AI mặc định' : provider} đang viết Tập {episodeNumber}...
                  </div>
                  <div className="flex gap-1">
                    {[0, 1, 2, 3, 4].map(i => (
                      <div key={i} style={{
                        width: 4, height: 18, borderRadius: 2,
                        background: 'var(--accent)',
                        animation: `pulse 0.8s ease-in-out ${i * 0.15}s infinite alternate`,
                        opacity: 0.6,
                      }} />
                    ))}
                  </div>
                </div>

                <div ref={logRef} className="rounded-lg p-3" style={{
                  background: '#080810', border: '1px solid var(--border)',
                  fontFamily: 'monospace', fontSize: 11, maxHeight: 200, overflowY: 'auto',
                }}>
                  {genLog.map((line, i) => (
                    <div key={i} style={{ color: line.includes('❌') ? 'var(--red)' : line.includes('✅') ? 'var(--green)' : 'var(--muted)' }}>
                      {line}
                    </div>
                  ))}
                </div>

                {error && (
                  <div className="rounded p-3 text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                    {error} <button onClick={() => setStep('setup')} className="underline ml-1">Quay lại</button>
                  </div>
                )}
              </div>
            )}

            {/* REVIEW */}
            {step === 'review' && result && (
              <div className="p-6 flex flex-col gap-4">
                <div className="rounded-lg p-4 flex flex-col gap-2" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
                  <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>"{result.title}"</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{result.description}</div>
                  <div className="flex gap-3 text-xs mt-1">
                    <span className="flex items-center gap-1" style={{ color: 'var(--accent)' }}><Clapperboard size={10} /> {result.scenes.length} cảnh</span>
                  </div>
                  {result.continuity_notes && (
                    <div className="text-xs mt-1 p-2 rounded" style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid var(--accent-glow)' }}>
                      <Link2 size={10} style={{ display: 'inline', marginRight: 3 }} />{result.continuity_notes}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <div className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: 1 }}>
                    Kịch bản ({result.scenes.length} cảnh)
                  </div>
                  {result.scenes.map((s, i) => (
                    <ScenePreview key={i} scene={s} index={i} onEdit={setEditingScene} />
                  ))}
                </div>

                <button onClick={handleGenerate} className="text-xs text-center" style={{ color: 'var(--muted)' }}>
                  <RefreshCw size={13} /> Không hài lòng? Tạo lại
                </button>

                {error && (
                  <div className="rounded p-3 text-xs" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>
                    {error}
                  </div>
                )}
              </div>
            )}

            {/* CREATING */}
            {step === 'creating' && (
              <div className="p-6 flex flex-col items-center gap-4 py-10">
                <Settings2 size={36} style={{ color: 'var(--muted)' }} />
                <div className="font-bold" style={{ color: 'var(--text)' }}>Đang tạo tập {episodeNumber}...</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>Tạo video → {result?.scenes.length} cảnh</div>
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{
                      width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)',
                      animation: `pulse 0.6s ease-in-out ${i * 0.2}s infinite alternate`,
                    }} />
                  ))}
                </div>
                {error && (
                  <div className="rounded p-3 text-xs w-full" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}>{error}</div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          {step !== 'generating' && step !== 'creating' && (
            <div className="px-6 py-4 flex justify-between" style={{ borderTop: '1px solid var(--border)' }}>
              <button
                onClick={() => {
                  if (step === 'setup') onCancel()
                  else if (step === 'review') setStep('setup')
                }}
                className="px-4 py-2 rounded text-xs"
                style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                {step === 'setup' ? 'Hủy' : '← Quay lại'}
              </button>

              {step === 'setup' && (
                <button
                  onClick={handleGenerate}
                  disabled={!episodeTitle.trim() || !episodeBrief.trim()}
                  className="px-5 py-2 rounded text-xs font-bold flex items-center gap-2"
                  style={{ background: 'var(--accent)', color: '#fff', opacity: (!episodeTitle.trim() || !episodeBrief.trim()) ? 0.5 : 1 }}
                >
                  <Bot size={14} /> AI viết kịch bản
                </button>
              )}

              {step === 'review' && result && (
                <button
                  onClick={handleCreate}
                  className="px-5 py-2 rounded text-xs font-bold"
                  style={{ background: 'var(--green)', color: '#fff' }}
                >
                  <CheckCircle size={14} /> Tạo Tập {episodeNumber}
                </button>
              )}
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
