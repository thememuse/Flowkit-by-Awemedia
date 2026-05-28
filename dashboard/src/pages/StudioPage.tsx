import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAPI, postAPI, patchAPI, deleteAPI } from '../api/client'
import type { Project, Video, Scene, Character } from '../types'
import PipelineView from '../components/pipeline/PipelineView'
import AIEpisodeCreator from '../components/studio/AIEpisodeCreator'
import AutoPipelineModal from '../components/studio/AutoPipelineModal'
import ProductionPanel from '../components/studio/ProductionPanel'
import {
  ScanEye, FolderOpen, Link, Zap, Loader2,
  RefreshCw, Bot, Clapperboard, Scissors,
  Users, User, MapPin, Layers, Edit2, Film, X, Check,
  Trash2, AlertTriangle, Image as ImageIcon,
} from 'lucide-react'

type StudioTab = 'pipeline' | 'create' | 'characters' | 'produce' | 'postprod'

interface Props {
  projectId: string
  onBack: () => void
}



// ── Action Button ──────────────────────────────────────────
function ActionBtn({ label, description, icon: Icon, onClick, loading, disabled, variant = 'primary' }: {
  label: string
  description?: string
  icon: React.ElementType
  onClick: () => void
  loading?: boolean
  disabled?: boolean
  variant?: 'primary' | 'secondary' | 'warning'
}) {
  const colors = {
    primary: 'var(--accent)',
    secondary: 'var(--green)',
    warning: 'var(--yellow)',
  }
  const color = disabled ? 'var(--muted)' : colors[variant]

  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex items-center gap-2.5 rounded-lg p-3 text-left transition-all"
      style={{
        background: 'var(--card)',
        border: `1px solid ${disabled ? 'var(--border)' : color + '55'}`,
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        width: '100%',
      }}
    >
      <div
        className="flex items-center justify-center rounded flex-shrink-0"
        style={{ width: 30, height: 30, background: color + '18' }}
      >
        {loading
          ? <Loader2 size={14} color={color} className="spin" />
          : <Icon size={14} color={color} strokeWidth={2} />
        }
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="text-xs font-semibold" style={{ color }}>
          {loading ? 'Đang xử lý...' : label}
        </div>
        {description && (
          <div className="text-xs" style={{ color: 'var(--muted)' }}>{description}</div>
        )}
      </div>
    </button>
  )
}

// ── Edit Project Modal ────────────────────────────────────
function EditProjectModal({ project, onSave, onClose }: {
  project: Project
  onSave: (updated: Project) => void
  onClose: () => void
}) {
  const [name, setName] = useState(project.name)
  const [description, setDescription] = useState(project.description ?? '')
  const [story, setStory] = useState(project.story ?? '')
  const [material, setMaterial] = useState(project.material ?? 'realistic')
  const [language, setLanguage] = useState(project.language ?? 'vi')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const MATERIALS = [
    'realistic', '3d_pixar', 'anime', 'ghibli', 'stop_motion',
    'oil_painting', 'comic_book', 'cyberpunk', 'minecraft',
  ]

  async function handleSave() {
    if (!name.trim()) { setError('Tên dự án không được trống'); return }
    setSaving(true); setError('')
    try {
      const updated = await patchAPI<Project>(`/api/projects/${project.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        story: story.trim() || null,
        material: material || null,
        language: language || null,
      })
      onSave(updated)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', padding: '6px 10px',
    fontSize: 12, outline: 'none', width: '100%',
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="rounded-xl flex flex-col gap-4 w-full" style={{
        maxWidth: 480, background: 'var(--card)', border: '1px solid var(--border)',
        overflow: 'hidden', maxHeight: '90vh',
      }}>
        {/* Header */}
        <div className="px-5 pt-5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <Edit2 size={15} color="var(--accent)" />
            <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>Sửa dự án</span>
          </div>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}><X size={16} /></button>
        </div>
        {/* Body */}
        <div className="px-5 overflow-y-auto flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Tên dự án *</label>
            <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} placeholder="Tên dự án..." />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Mô tả ngắn</label>
            <input value={description} onChange={e => setDescription(e.target.value)} style={inputStyle} placeholder="Mô tả 1-2 câu..." />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Câu chuyện / Nội dung</label>
            <textarea value={story} onChange={e => setStory(e.target.value)} rows={5}
              style={{ ...inputStyle, resize: 'vertical', minHeight: 80 }}
              placeholder="Mô tả câu chuyện, bối cảnh, thông điệp chính..."
            />
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--muted)' }}>Phong cách (Material)</label>
              <select value={material} onChange={e => setMaterial(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}>
                {MATERIALS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--muted)' }}>Ngôn ngữ</label>
              <select value={language} onChange={e => setLanguage(e.target.value)}
                style={{ ...inputStyle, cursor: 'pointer' }}>
                <option value="vi">Tiếng Việt</option>
                <option value="en">Tiếng Anh</option>
                <option value="ja">Tiếng Nhật</option>
                <option value="ko">Tiếng Hàn</option>
                <option value="es">Tiếng Tây Ban Nha</option>
                <option value="fr">Tiếng Pháp</option>
                <option value="pt">Tiếng Bồ Đào Nha</option>
                <option value="zh">Tiếng Trung</option>
              </select>
            </div>
          </div>
          {error && <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>{error}</div>}
        </div>
        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2 justify-end flex-shrink-0">
          <button onClick={onClose} className="btn btn-secondary text-xs">Hủy</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold"
            style={{ background: 'var(--accent)', color: '#fff', opacity: saving ? 0.7 : 1 }}>
            {saving ? <><Loader2 size={11} className="spin" /> Đang lưu...</> : <><Check size={11} /> Lưu</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Video Modal ───────────────────────────────────────
function EditVideoModal({ video, onSave, onClose }: {
  video: Video
  onSave: (updated: Video) => void
  onClose: () => void
}) {
  const [title, setTitle] = useState(video.title)
  const [description, setDescription] = useState(video.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', padding: '6px 10px',
    fontSize: 12, outline: 'none', width: '100%',
  }

  async function handleSave() {
    if (!title.trim()) { setError('Tên video không được trống'); return }
    setSaving(true); setError('')
    try {
      const updated = await patchAPI<Video>(`/api/videos/${video.id}`, {
        title: title.trim(),
        description: description.trim() || null,
      })
      onSave(updated)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="rounded-xl flex flex-col gap-4 w-full" style={{
        maxWidth: 400, background: 'var(--card)', border: '1px solid var(--border)', overflow: 'hidden',
      }}>
        <div className="px-5 pt-5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Film size={15} color="var(--accent)" />
            <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>Sửa tập / video</span>
          </div>
          <button onClick={onClose} style={{ color: 'var(--muted)' }}><X size={16} /></button>
        </div>
        <div className="px-5 flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Tên tập / video *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} style={inputStyle}
              placeholder="Tên video..." />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--muted)' }}>Mô tả</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
              style={{ ...inputStyle, resize: 'vertical' }} placeholder="Mô tả ngắn..." />
          </div>
          <div className="text-xs p-2 rounded" style={{ background: 'rgba(124,91,245,0.06)', color: 'var(--muted)', border: '1px solid var(--border)' }}>
            <span style={{ color: 'var(--accent)' }}>Hướng:</span> {video.orientation || 'VERTICAL'} — không thể thay đổi sau khi tạo.
          </div>
          {error && <div className="text-xs p-2 rounded" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)' }}>{error}</div>}
        </div>
        <div className="px-5 pb-5 flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-secondary text-xs">Hủy</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded text-xs font-bold"
            style={{ background: 'var(--accent)', color: '#fff', opacity: saving ? 0.7 : 1 }}>
            {saving ? <><Loader2 size={11} className="spin" /> Đang lưu...</> : <><Check size={11} /> Lưu</>}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function StudioPage({ projectId, onBack }: Props) {
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [selectedVideo, setSelectedVideo] = useState<Video | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [characters, setCharacters] = useState<Character[]>([])
  const [tab, setTab] = useState<StudioTab>('pipeline')
  const [loading, setLoading] = useState(true)
  const [log, setLog] = useState<string[]>([])
  const [showAIEpisode, setShowAIEpisode] = useState(false)
  const [showAutoPipeline, setShowAutoPipeline] = useState(false)
  const [showEditProject, setShowEditProject] = useState(false)
  const [showEditVideo, setShowEditVideo] = useState(false)
  const [showDeleteVideo, setShowDeleteVideo] = useState(false)
  const [deletingVideo, setDeletingVideo] = useState(false)

  // Track if pipeline is currently running (lifted from ProductionPanel for persistence)
  const [pipelineRunning, setPipelineRunning] = useState(false)

  const [reviewLoading, setReviewLoading] = useState(false)
  const [syncLoading, setSyncLoading] = useState(false)

  const addLog = useCallback((msg: string) => {
    setLog(prev => [...prev.slice(-99), `[${new Date().toLocaleTimeString('vi-VN')}] ${msg}`])
  }, [])

  useEffect(() => {
    loadAll()
  }, [projectId])

  async function loadAll() {
    setLoading(true)
    try {
      const [proj, vids, chars] = await Promise.all([
        fetchAPI<Project>(`/api/projects/${projectId}`),
        fetchAPI<Video[]>(`/api/videos?project_id=${projectId}`),
        fetchAPI<Character[]>(`/api/projects/${projectId}/characters`),
      ])
      setProject(proj)
      setVideos(vids)
      setCharacters(chars)
      if (vids.length > 0) {
        const firstVid = vids[0]
        setSelectedVideo(prev => prev ?? firstVid)  // don't reset if user already selected
        const sc = await fetchAPI<Scene[]>(`/api/scenes?video_id=${firstVid.id}`)
        setScenes(sc)
      }
      // Auto-sync if project not yet on Google Flow
      if (!proj.flow_synced) {
        autoSyncFlow(proj.id)
      }
    } catch (e) {
      addLog(`Lỗi tải dữ liệu: ${e}`)
    } finally {
      setLoading(false)
    }
  }

  // ── Auto Sync (silent) ───────────────────────────────────
  async function autoSyncFlow(pid: string) {
    try {
      const health = await fetchAPI<{ extension_connected: boolean }>('/health')
      if (!health.extension_connected) return
      setSyncLoading(true)
      addLog('🔗 Extension connected — đang tạo project trên Google Flow...')
      const result = await postAPI<{ ok: boolean; flow_project_id?: string; error?: string }>(
        `/api/projects/${pid}/sync-flow`, {}
      )
      if (result.ok) {
        addLog(`✓ Project đã được tạo trên Google Flow`)
        setProject(prev => prev ? { ...prev, flow_synced: true } : prev)
      }
    } catch (_) {
      // Silent fail for auto-sync
    } finally {
      setSyncLoading(false)
    }
  }

  async function selectVideo(v: Video) {
    setSelectedVideo(v)
    try {
      const sc = await fetchAPI<Scene[]>(`/api/scenes?video_id=${v.id}`)
      setScenes(sc)
    } catch (_) {}
  }

  async function handleDeleteVideo() {
    if (!selectedVideo) return
    setDeletingVideo(true)
    try {
      await deleteAPI(`/api/videos/${selectedVideo.id}`)
      addLog(`✓ Đã xóa tập: ${selectedVideo.title}`)
      setShowDeleteVideo(false)
      const freshVids = await fetchAPI<Video[]>(`/api/videos?project_id=${projectId}`)
      setVideos(freshVids)
      if (freshVids.length > 0) {
        selectVideo(freshVids[0])
      } else {
        setSelectedVideo(null)
        setScenes([])
      }
    } catch (e) {
      addLog(`Lỗi khi xóa tập: ${e}`)
    } finally {
      setDeletingVideo(false)
    }
  }

  // ── Review Video ─────────────────────────────────────────
  async function handleReview() {
    if (!selectedVideo) return
    setReviewLoading(true)
    addLog('Đang review video bằng Claude Vision...')
    try {
      const result = await postAPI<{ scores?: Record<string, number>; error?: string }>(
        `/api/videos/${selectedVideo.id}/review?mode=light`, {}
      )
      if (result.error) {
        addLog(`Review lỗi: ${result.error}`)
      } else {
        addLog('Review hoàn thành. Xem chi tiết trong thư mục output/review/')
      }
    } catch (e: unknown) {
      addLog(`Lỗi review: ${e instanceof Error ? e.message : e}`)
    } finally {
      setReviewLoading(false)
    }
  }

  // ── Sync to Google Flow ──────────────────────────────────
  async function handleSyncFlow() {
    setSyncLoading(true)
    addLog('Đang sync project lên Google Flow...')
    try {
      const result = await postAPI<{ ok: boolean; flow_project_id?: string; error?: string }>(
        `/api/projects/${projectId}/sync-flow`, {}
      )
      if (result.ok) {
        addLog(`✓ Đã tạo project trên Google Flow: ${result.flow_project_id}`)
        setProject(prev => prev ? { ...prev, flow_synced: true } : prev)
      } else {
        addLog(`✗ Sync thất bại: ${result.error}`)
      }
    } catch (e: unknown) {
      addLog(`Lỗi sync: ${e instanceof Error ? e.message : e}`)
    } finally {
      setSyncLoading(false)
    }
  }

  if (loading || !project) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>Đang tải Studio...</div>
  }

  const tabs: { key: StudioTab; label: string; icon: React.ElementType }[] = [
    { key: 'pipeline', label: 'Pipeline', icon: Layers },
    { key: 'produce', label: 'Sản xuất', icon: Clapperboard },
    { key: 'characters', label: 'Nhân vật', icon: Users },
    { key: 'postprod', label: 'Hậu kỳ', icon: Scissors },
  ]


  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <button
          onClick={onBack}
          className="text-xs px-3 py-1.5 rounded"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          ← Quay lại
        </button>
        <div className="flex flex-col">
          <h1 className="font-bold text-sm flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
            <Clapperboard size={14} color="var(--accent)" />
            {project.name}
          </h1>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {project.material} • {project.user_paygate_tier?.includes('TWO') ? 'Tier 2' : 'Tier 1'} •{' '}
            {characters.length} nhân vật • {scenes.length} cảnh
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {/* Batch Image / Video Quick Links */}
        {selectedVideo && (
          <div className="flex items-center gap-1.5 mr-2 flex-shrink-0">
            <button
              onClick={() => navigate(`/batch-images/${projectId}/${selectedVideo.id}`)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-bold hover:opacity-90 transition-all border"
              style={{ background: 'rgba(34,197,94,0.08)', color: 'var(--green)', borderColor: 'rgba(34,197,94,0.25)' }}
            >
              <ImageIcon size={12} /> Batch Ảnh 📸
            </button>
            <button
              onClick={() => navigate(`/batch-videos/${projectId}/${selectedVideo.id}`)}
              className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded font-bold hover:opacity-90 transition-all border"
              style={{ background: 'rgba(245,158,11,0.08)', color: 'var(--yellow)', borderColor: 'rgba(245,158,11,0.25)' }}
            >
              <Film size={12} /> Batch Video 🎬
            </button>
          </div>
        )}
        {/* Edit Project */}
        <button
          onClick={() => setShowEditProject(true)}
          className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
          title="Sửa thông tin dự án"
        >
          <Edit2 size={11} /> Sửa dự án
        </button>
        <button
          onClick={handleSyncFlow}
          disabled={syncLoading || project.flow_synced}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-semibold"
          style={{
            background: project.flow_synced ? 'rgba(34,197,94,0.1)' : 'rgba(251,191,36,0.1)',
            color: project.flow_synced ? 'var(--green)' : 'var(--yellow)',
            border: `1px solid ${project.flow_synced ? 'rgba(34,197,94,0.3)' : 'rgba(251,191,36,0.3)'}`,
            opacity: syncLoading ? 0.6 : 1,
            cursor: project.flow_synced ? 'default' : 'pointer',
          }}
          title={project.flow_synced ? 'Project đã sync với Google Flow' : 'Chưa tạo trên Google Flow — click để sync'}
        >
          {syncLoading
            ? <><Loader2 size={11} className="spin" /> Syncing...</>
            : <><Link size={11} /> {project.flow_synced ? 'Flow Synced' : 'Sync Flow'}</>
          }
        </button>
        <button
          onClick={loadAll}
          className="flex items-center justify-center text-xs px-2.5 py-1.5 rounded"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* Edit modals */}
      {showEditProject && project && (
        <EditProjectModal
          project={project}
          onSave={(updated) => { setProject(updated); setShowEditProject(false) }}
          onClose={() => setShowEditProject(false)}
        />
      )}
      {showEditVideo && selectedVideo && (
        <EditVideoModal
          video={selectedVideo}
          onSave={(updated) => {
            setSelectedVideo(updated)
            setVideos(prev => prev.map(v => v.id === updated.id ? updated : v))
            setShowEditVideo(false)
          }}
          onClose={() => setShowEditVideo(false)}
        />
      )}

      {showDeleteVideo && selectedVideo && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
        >
          <div
            className="rounded-2xl p-6 flex flex-col gap-4"
            style={{ background: 'var(--surface)', border: '1px solid rgba(239,68,68,0.4)', width: 360 }}
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} style={{ color: 'var(--red)', flexShrink: 0 }} />
              <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>Xóa tập video?</span>
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Bạn sắp xóa tập <strong style={{ color: 'var(--text)' }}>"{selectedVideo.title}"</strong>.
              Hành động này sẽ xóa toàn bộ các cảnh và tiến trình của tập này. Không thể hoàn tác.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteVideo(false)}
                className="text-xs px-4 py-2 rounded"
                style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                Hủy
              </button>
              <button
                onClick={handleDeleteVideo}
                disabled={deletingVideo}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded font-semibold"
                style={{ background: 'var(--red)', color: '#fff', opacity: deletingVideo ? 0.6 : 1 }}
              >
                <Trash2 size={12} /> {deletingVideo ? 'Đang xóa...' : 'Xác nhận xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showAIEpisode && project && (
        <AIEpisodeCreator
          project={project}
          characters={characters}
          existingVideos={videos}
          onCreated={async (videoId) => {
            setShowAIEpisode(false)
            await loadAll()
            const newVid = videos.find(v => v.id === videoId)
            if (newVid) selectVideo(newVid)
            addLog(`✓ Đã tạo tập mới với ${scenes.length} cảnh AI`)
          }}
          onCancel={() => setShowAIEpisode(false)}
        />
      )}

      {/* Auto-Pipeline modal */}
      {showAutoPipeline && project && (
        <AutoPipelineModal
          project={project}
          characters={characters}
          existingVideos={videos}
          onCreated={async (videoId) => {
            setShowAutoPipeline(false)
            await loadAll()
            const newVid = videos.find(v => v.id === videoId)
            if (newVid) selectVideo(newVid)
            setTab('pipeline')
            addLog(`✓ Auto-Pipeline hoàn thành — đã tạo video ${videoId.slice(0, 8)}...`)
          }}
          onCancel={() => setShowAutoPipeline(false)}
        />
      )}

      {/* Video selector + add episode */}
      {videos.length > 0 && (
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Tập:</span>
          <select
            value={selectedVideo?.id ?? ''}
            onChange={e => {
              const v = videos.find(v => v.id === e.target.value)
              if (v) selectVideo(v)
            }}
            className="text-xs px-2 py-1 rounded outline-none flex-1"
            style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
          >
            {videos.map((v, i) => (
              <option key={v.id} value={v.id}>
                Tập {i + 1}: {v.title} ({v.orientation || 'VERTICAL'})
              </option>
            ))}
          </select>
          {/* Edit current video */}
          {selectedVideo && (
            <>
              <button
                onClick={() => setShowEditVideo(true)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded flex-shrink-0"
                style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                title="Sửa tập này"
              >
                <Edit2 size={11} />
              </button>
              <button
                onClick={() => setShowDeleteVideo(true)}
                className="flex items-center gap-1 text-xs px-2 py-1 rounded flex-shrink-0"
                style={{ background: 'var(--card)', color: 'var(--red)', border: '1px solid rgba(239, 68, 68, 0.2)' }}
                title="Xóa tập này"
              >
                <Trash2 size={11} />
              </button>
            </>
          )}
          <button
            onClick={() => setShowAIEpisode(true)}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded font-bold flex-shrink-0"
            style={{ background: 'var(--accent)', color: '#fff' }}
            title="Dùng AI tạo tập mới"
          >
            <Bot size={11} /> + Tập
          </button>
        </div>
      )}

      {/* Tab nav — show running badge on Sản xuất when pipeline is active */}
      <div className="flex gap-1 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
          className="flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium transition-all"
          style={{
            background: 'transparent',
            color: tab === t.key ? 'var(--accent)' : 'var(--muted)',
            borderBottom: tab === t.key ? '2px solid var(--accent)' : '2px solid transparent',
            borderRadius: 0,
          }}
        >
          <t.icon size={13} />
          {t.label}
          {/* Running badge */}
          {t.key === 'produce' && pipelineRunning && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs"
              style={{ background: 'rgba(124,91,245,0.2)', color: 'var(--accent)', fontSize: 9, lineHeight: 1 }}>
              <Loader2 size={7} className="spin" /> Running
            </span>
          )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-auto min-h-0">

        {/* PIPELINE — always mounted to preserve WebSocket state and progress across tab switches */}
        <div style={{ display: tab === 'pipeline' ? 'block' : 'none' }}>
          {selectedVideo ? (
            <PipelineView
              projectId={projectId}
              videoId={selectedVideo.id}
              orientation={selectedVideo.orientation || 'VERTICAL'}
            />
          ) : (
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Chưa có video nào — tạo video trong tab Sản xuất
            </div>
          )}
        </div>

        {/* SẢN XUẤT — wrapper always present, hidden via display when not active */}
        <div style={{ display: tab === 'produce' ? 'block' : 'none' }}>
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: 1 }}>
                Pipeline sản xuất
                {pipelineRunning && (
                  <span className="ml-2 inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent)', fontWeight: 'normal' }}>
                    <Loader2 size={10} className="spin" /> Đang chạy...
                  </span>
                )}
              </div>
              {/* Auto-Pipeline CTA — disabled when pipeline running */}
              <button
                onClick={() => setShowAutoPipeline(true)}
                disabled={pipelineRunning}
                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-bold"
                style={{
                  background: pipelineRunning ? 'var(--surface)' : 'linear-gradient(135deg, var(--accent), #8b5cf6)',
                  color: pipelineRunning ? 'var(--muted)' : '#fff',
                  opacity: pipelineRunning ? 0.6 : 1,
                  cursor: pipelineRunning ? 'not-allowed' : 'pointer',
                }}
                title={pipelineRunning ? 'Pipeline đang chạy — chờ xong rồi mới tạo tiếp' : 'Chạy toàn bộ pipeline tự động'}
              >
                <Zap size={11} /> Auto-Pipeline
              </button>
            </div>

            {!selectedVideo ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-lg p-4 text-center flex flex-col items-center gap-3"
                  style={{ background: 'rgba(59,130,246,0.06)', border: '1px dashed rgba(59,130,246,0.3)' }}>
                <div className="flex items-center justify-center" style={{ fontSize: 40, marginBottom: 4 }}>
                  <Bot size={40} color="var(--accent)" strokeWidth={1.5} />
                </div>
                <div className="text-sm font-bold" style={{ color: 'var(--text)' }}>Tạo tập đầu tiên với AI</div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  Claude sẽ viết toàn bộ kịch bản, prompts, lời dẫn dựa trên câu chuyện và nhân vật của project
                </div>
                <button
                  onClick={() => setShowAIEpisode(true)}
                  className="flex items-center gap-1.5 px-5 py-2 rounded text-xs font-bold"
                  style={{ background: 'var(--accent)', color: '#fff' }}
                >
                  <Bot size={12} /> AI tạo kịch bản
                  </button>
                </div>

                <div className="text-center text-xs" style={{ color: 'var(--muted)' }}>hoặc</div>

                <CreateVideoForm
                  projectId={projectId}
                  onCreated={async (v) => {
                    setVideos(prev => [...prev, v])
                    setSelectedVideo(v)
                    loadAll()
                    addLog(`✓ Đã tạo video: ${v.title}`)
                  }}
                />
              </div>
            ) : (
              /* ProductionPanel ALWAYS mounted when selectedVideo exists, keeps polling alive */
              <ProductionPanel
                projectId={projectId}
                videoId={selectedVideo.id}
                orientation={selectedVideo.orientation || 'VERTICAL'}
                onLog={addLog}
                onRunningChange={setPipelineRunning}
              />
            )}

            {/* Activity log */}
            {log.length > 0 && (
              <div className="rounded-lg p-3 mt-2" style={{
                background: '#080810',
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: 11,
                maxHeight: 180,
                overflowY: 'auto',
              }}>
                {log.map((line, i) => (
                  <div key={i} style={{ color: line.includes('✗') ? 'var(--red)' : line.includes('✓') ? 'var(--green)' : 'var(--muted)' }}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* NHÂN VẬT */}
        {tab === 'characters' && (
          <div className="flex flex-col gap-3">
            <div className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--muted)', letterSpacing: 1 }}>
              Nhân vật & Thực thể ({characters.length})
            </div>
            {characters.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Chưa có nhân vật nào</div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))' }}>
                {characters.map(c => (
                  <div key={c.id} className="rounded-lg p-3 flex flex-col gap-2"
                    style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                    <div className="rounded overflow-hidden" style={{
                      width: '100%', aspectRatio: '1/1',
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                    }}>
                      {c.reference_image_url ? (
                        <img src={c.reference_image_url} alt={c.name}
                          className="w-full h-full object-cover" />
                      ) : (
                        <div className="flex items-center justify-center h-full">
                          {c.entity_type === 'location'
                            ? <MapPin size={18} color="var(--muted)" />
                            : <User size={18} color="var(--muted)" />
                          }
                        </div>
                      )}
                    </div>
                    <div className="text-xs font-bold truncate" style={{ color: 'var(--text)' }}>{c.name}</div>
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full" style={{
                        background: c.media_id ? 'var(--green)' : 'var(--red)'
                      }} />
                      <span className="text-xs" style={{
                        color: c.media_id ? 'var(--green)' : 'var(--red)'
                      }}>
                        {c.media_id ? 'Sẵn sàng' : 'Cần ảnh'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* HẬU KỲ */}
        {tab === 'postprod' && (
          <div className="flex flex-col gap-4">
            <div className="text-xs font-bold uppercase mb-1" style={{ color: 'var(--muted)', letterSpacing: 1 }}>
              Hậu kỳ & Xuất video
            </div>

            <div className="flex flex-col gap-2">
              <ActionBtn
                label="Review chất lượng video (Claude Vision)"
                description="Đánh giá từng cảnh, phát hiện lỗi, điểm số 1-10"
                icon={ScanEye}
                onClick={handleReview}
                loading={reviewLoading}
                disabled={!selectedVideo}
              />

              <ActionBtn
                label="Mở thư mục output"
                description="Xem video, ảnh, TTS đã tạo trong Finder/Explorer"
                icon={FolderOpen}
                onClick={async () => {
                  const electronAPI = (window as unknown as { electronAPI?: {
                    revealFile?: (p: string) => void
                  } }).electronAPI
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
                variant="secondary"
              />
            </div>

            {log.length > 0 && (
              <div className="rounded-lg p-3" style={{
                background: '#080810',
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: 11,
                maxHeight: 180,
                overflowY: 'auto',
              }}>
                {log.map((line, i) => (
                  <div key={i} style={{ color: 'var(--muted)' }}>{line}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Create Video Form ──────────────────────────────────────
function CreateVideoForm({ projectId, onCreated }: {
  projectId: string
  onCreated: (v: Video) => void
}) {
  const [title, setTitle] = useState('')
  const [orientation, setOrientation] = useState<'VERTICAL' | 'HORIZONTAL'>('VERTICAL')
  const [sceneCount, setSceneCount] = useState(10)
  const [creating, setCreating] = useState(false)

  async function handleCreate() {
    if (!title.trim()) return
    setCreating(true)
    try {
      // Tạo video
      const video = await postAPI<Video>('/api/videos', {
        project_id: projectId,
        title: title.trim(),
        orientation,
      })

      // Tạo scenes rỗng
      for (let i = 0; i < sceneCount; i++) {
        await postAPI('/api/scenes', {
          video_id: video.id,
          display_order: i,
          chain_type: i === 0 ? 'ROOT' : 'CONTINUATION',
          prompt: '',
          narrator_text: '',
        })
      }

      onCreated(video)
    } catch (e: unknown) {
      console.error(e)
    } finally {
      setCreating(false)
    }
  }

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    color: 'var(--text)',
    padding: '6px 10px',
    fontSize: 12,
    outline: 'none',
    width: '100%',
  }

  return (
    <div className="rounded-xl p-4 flex flex-col gap-3" style={{
      background: 'var(--card)',
      border: '1px solid var(--border)',
    }}>
      <div className="text-xs font-bold" style={{ color: 'var(--text)' }}>Tạo video mới</div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs" style={{ color: 'var(--muted)' }}>Tên video</label>
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Tập 1 — Mở đầu..."
          style={inputStyle}
        />
      </div>

      <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs" style={{ color: 'var(--muted)' }}>Hướng video</label>
          <select
            value={orientation}
            onChange={e => setOrientation(e.target.value as 'VERTICAL' | 'HORIZONTAL')}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="VERTICAL">Dọc (9:16)</option>
            <option value="HORIZONTAL">Ngang (16:9)</option>
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-xs" style={{ color: 'var(--muted)' }}>Số cảnh</label>
          <input
            type="number"
            min={1}
            max={60}
            value={sceneCount}
            onChange={e => setSceneCount(Number(e.target.value))}
            style={inputStyle}
          />
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={!title.trim() || creating}
        className="px-4 py-2 rounded text-xs font-bold mt-1"
        style={{
          background: 'var(--accent)',
          color: '#fff',
          opacity: !title.trim() || creating ? 0.6 : 1,
        }}
      >
        {creating ? 'Đang tạo...' : `Tạo video (${sceneCount} cảnh)`}
      </button>
    </div>
  )
}
