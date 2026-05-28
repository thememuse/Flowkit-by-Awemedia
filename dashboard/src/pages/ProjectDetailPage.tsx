import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAPI, patchAPI, deleteAPI } from '../api/client'
import type { Project, Character, Video, Scene, ChainType, StatusType } from '../types'
import EditableText from '../components/projects/EditableText'
import { Clapperboard, Trash2, AlertTriangle, Download, Loader2, Film, ChevronRight } from 'lucide-react'
import { useWebSocket } from '../api/useWebSocket'
import { useDownload, buildFilename } from '../api/useDownload'

type Tab = 'Tổng quan' | 'Nhân vật' | 'Video' | 'Cảnh'

interface Props {
  projectId: string
  onBack: () => void
  onGoStudio?: (projectId: string) => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
}

function StatusDot({ status }: { status: StatusType }) {
  const colors: Record<StatusType, string> = {
    COMPLETED: 'var(--green)',
    PROCESSING: 'var(--yellow)',
    PENDING: 'var(--muted)',
    FAILED: 'var(--red)',
  }
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ background: colors[status] ?? 'var(--muted)' }}
      title={status}
    />
  )
}

function Badge({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: color ?? 'rgba(100,116,139,0.2)', color: 'var(--muted)' }}
    >
      {label}
    </span>
  )
}

function ChainBadge({ type }: { type: ChainType }) {
  const styles: Record<ChainType, { bg: string; color: string }> = {
    ROOT: { bg: 'rgba(59,130,246,0.2)', color: 'var(--accent)' },
    CONTINUATION: { bg: 'rgba(34,197,94,0.2)', color: 'var(--green)' },
    INSERT: { bg: 'rgba(245,158,11,0.2)', color: 'var(--yellow)' },
  }
  const s = styles[type] ?? styles.ROOT
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
      {type}
    </span>
  )
}

// ---- Overview Tab ----
function OverviewTab({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  async function patchProject(field: string, value: string) {
    await patchAPI(`/api/projects/${project.id}`, { [field]: value })
    onRefresh()
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="rounded-lg p-4 flex flex-col gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div>
          <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>TÊN DỰ ÁN</div>
          <EditableText value={project.name} onSave={v => patchProject('name', v)} className="font-bold text-sm" />
        </div>
        <div>
          <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>MÔ TẢ</div>
          <EditableText value={project.description ?? ''} onSave={v => patchProject('description', v)} multiline className="text-xs" />
        </div>
        <div>
          <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>CÂU CHUYỆN</div>
          <EditableText value={project.story ?? ''} onSave={v => patchProject('story', v)} multiline className="text-xs" />
        </div>
      </div>

      <div className="rounded-lg p-4 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>THÔNG TIN</div>
        <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text)' }}>
          <Badge label={project.material} />
          {project.user_paygate_tier && (
            <Badge
              label={project.user_paygate_tier.includes('TWO') ? 'TIER 2' : 'TIER 1'}
              color={project.user_paygate_tier.includes('TWO') ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)'}
            />
          )}
          <Badge label={project.status} />
        </div>
        <div className="flex flex-col gap-1 mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          <div>Tạo lúc: {formatDate(project.created_at)}</div>
          <div>Cập nhật: {formatDate(project.updated_at)}</div>
        </div>
      </div>
    </div>
  )
}

// ---- Characters Tab ----
function CharactersTab({ characters, onRefresh }: { characters: Character[]; onRefresh: () => void }) {
  async function patchChar(cid: string, field: string, value: string) {
    await patchAPI(`/api/characters/${cid}`, { [field]: value })
    onRefresh()
  }

  if (characters.length === 0) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>Chưa có nhân vật nào trong dự án này.</div>
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
      {characters.map(ch => (
        <div key={ch.id} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          {/* Reference image */}
          <div
            className="rounded overflow-hidden flex items-center justify-center"
            style={{ width: '100%', aspectRatio: '1/1', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {ch.reference_image_url ? (
              <img src={ch.reference_image_url} alt={ch.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{ch.entity_type}</span>
            )}
          </div>

          {/* Name */}
          <div className="font-bold text-xs" style={{ color: 'var(--text)' }}>{ch.name}</div>

          {/* Entity type badge */}
          <Badge label={ch.entity_type} />

          {/* Description */}
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            <EditableText
              value={ch.description ?? ''}
              onSave={v => patchChar(ch.id, 'description', v)}
              multiline
              className="text-xs"
            />
          </div>

          {/* media_id indicator */}
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: ch.media_id ? 'var(--green)' : 'var(--red)' }}
            />
            <span style={{ color: ch.media_id ? 'var(--green)' : 'var(--red)' }}>
              {ch.media_id ? 'Sẵn sàng' : 'Thiếu ảnh'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Videos Tab ----
function VideosTab({ videos, project, onDeleteVideo, onViewVideo }: {
  videos: Video[]
  project: Project
  onDeleteVideo: (v: Video) => void
  onViewVideo: (vid: string) => void
}) {
  const { saveFile } = useDownload()
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  async function handleDownloadFinal(v: Video) {
    const url = v.orientation === 'HORIZONTAL' ? v.horizontal_url : (v.vertical_url || v.horizontal_url)
    if (!url) return
    setDownloadingId(v.id)
    try {
      const ext = url.split('.').pop() || 'mp4'
      const name = `${project.name}-${v.title}.${ext}`
      await saveFile({
        url,
        filename: name,
        projectName: project.name,
        sceneName: 'final',
      })
    } finally {
      setDownloadingId(null)
    }
  }

  if (videos.length === 0) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>Chưa có video nào trong dự án này.</div>
  }

  return (
    <div className="flex flex-col gap-3">
      {videos.map(v => {
        const finalUrl = v.orientation === 'HORIZONTAL' ? v.horizontal_url : (v.vertical_url || v.horizontal_url)
        return (
          <div key={v.id} className="rounded-lg p-4 flex items-center gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
            <div className="flex flex-col gap-1 flex-1">
              <div
                onClick={() => onViewVideo(v.id)}
                className="font-bold text-sm cursor-pointer hover:text-accent transition-colors flex items-center gap-1.5 group select-none"
              >
                <Film size={13} className="text-muted group-hover:text-accent transition-colors" />
                {v.title}
                <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 text-accent transition-all transform translate-x-[-4px] group-hover:translate-x-0" />
              </div>
              {v.description && <div className="text-xs" style={{ color: 'var(--muted)' }}>{v.description}</div>}
              <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
                Định dạng: {v.orientation === 'HORIZONTAL' ? 'Ngang (16:9)' : 'Dọc (9:16)'} | Thứ tự: {v.display_order}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <Badge label={v.status} />
              
              {finalUrl && (v.status === 'COMPLETED' || v.status === 'SUCCESS') && (
                <button
                  onClick={() => handleDownloadFinal(v)}
                  disabled={downloadingId === v.id}
                  title="Tải video hoàn chỉnh"
                  className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded font-semibold transition-colors"
                  style={{ background: 'rgba(34,197,94,0.15)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)' }}
                >
                  {downloadingId === v.id ? <Loader2 size={11} className="spin" /> : <Download size={11} />}
                  Tải xuống
                </button>
              )}

              <button
                onClick={() => onDeleteVideo(v)}
                title="Xóa video này"
                className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded font-semibold transition-colors"
                style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                <Trash2 size={11} />
                Xóa
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---- Scenes Tab ----
function ScenesTab({ videos, projectName }: { videos: Video[]; projectName: string }) {
  const [selectedVideoId, setSelectedVideoId] = useState(videos[0]?.id ?? '')
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(false)
  const { lastEvent } = useWebSocket()
  const { saveFile } = useDownload()
  const [downloadingSceneId, setDownloadingSceneId] = useState<string | null>(null)
  const [downloadingType, setDownloadingType] = useState<'image' | 'video' | 'upscale' | null>(null)

  const activeVideo = videos.find(v => v.id === selectedVideoId)
  const isHorizontal = activeVideo?.orientation === 'HORIZONTAL'

  const loadScenes = useCallback(() => {
    if (!selectedVideoId) return
    fetchAPI<Scene[]>(`/api/scenes?video_id=${selectedVideoId}`)
      .then(setScenes)
      .catch(console.error)
  }, [selectedVideoId])

  useEffect(() => {
    setLoading(true)
    if (!selectedVideoId) {
      setScenes([])
      setLoading(false)
      return
    }
    fetchAPI<Scene[]>(`/api/scenes?video_id=${selectedVideoId}`)
      .then(setScenes)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedVideoId])

  // Sync with WebSocket
  useEffect(() => {
    if (!lastEvent) return
    if (lastEvent.type === 'request_update' || lastEvent.type === 'urls_refreshed') {
      loadScenes()
    }
  }, [lastEvent, loadScenes])

  async function patchScene(sid: string, field: string, value: string) {
    await patchAPI(`/api/scenes/${sid}`, { [field]: value })
    loadScenes()
  }

  async function handleDownloadMedia(scene: Scene, type: 'image' | 'video' | 'upscale') {
    const url = type === 'image'
      ? (isHorizontal ? scene.horizontal_image_url : scene.vertical_image_url)
      : type === 'video'
      ? (isHorizontal ? scene.horizontal_video_url : scene.vertical_video_url)
      : (isHorizontal ? scene.horizontal_upscale_url : scene.vertical_upscale_url)

    if (!url) return
    setDownloadingSceneId(scene.id)
    setDownloadingType(type)
    
    try {
      const filename = buildFilename(scene.display_order, type)
      await saveFile({
        url,
        filename,
        projectName,
        sceneName: `canh-${scene.display_order + 1}`,
      })
    } finally {
      setDownloadingSceneId(null)
      setDownloadingType(null)
    }
  }

  function parseCharNames(raw: string | null): string[] {
    if (!raw) return []
    try { return JSON.parse(raw) } catch { return [] }
  }

  if (videos.length === 0) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>Chưa có video nào.</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Video selector */}
      <select
        value={selectedVideoId}
        onChange={e => setSelectedVideoId(e.target.value)}
        className="text-xs px-2 py-1.5 rounded outline-none w-64"
        style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
      >
        {videos.map(v => (
          <option key={v.id} value={v.id}>{v.title}</option>
        ))}
      </select>

      {loading ? (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>Đang tải cảnh...</div>
      ) : scenes.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>Chưa có cảnh nào trong video này.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {scenes.map(scene => {
            const charNames = parseCharNames(scene.character_names)
            const imgStatus = isHorizontal ? scene.horizontal_image_status : scene.vertical_image_status
            const vidStatus = isHorizontal ? scene.horizontal_video_status : scene.vertical_video_status
            const upscaleStatus = isHorizontal ? scene.horizontal_upscale_status : scene.vertical_upscale_status

            const imgUrl = isHorizontal ? scene.horizontal_image_url : scene.vertical_image_url
            const vidUrl = isHorizontal ? scene.horizontal_video_url : scene.vertical_video_url
            const upscaleUrl = isHorizontal ? scene.horizontal_upscale_url : scene.vertical_upscale_url

            return (
              <div key={scene.id} className="rounded-lg p-4 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>#{scene.display_order + 1}</span>
                  <ChainBadge type={scene.chain_type} />
                  {/* Status badges with download buttons */}
                  <div className="flex items-center gap-3 ml-auto">
                    {/* Image Status */}
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                      <StatusDot status={imgStatus} /> img
                      {imgStatus === 'COMPLETED' && imgUrl && (
                        <button
                          onClick={() => handleDownloadMedia(scene, 'image')}
                          disabled={downloadingSceneId === scene.id && downloadingType === 'image'}
                          title="Tải ảnh này"
                          className="p-0.5 rounded hover:bg-opacity-20 hover:bg-blue-500 transition-colors"
                          style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {downloadingSceneId === scene.id && downloadingType === 'image' ? (
                            <Loader2 size={10} className="spin" />
                          ) : (
                            <Download size={10} />
                          )}
                        </button>
                      )}
                    </span>

                    {/* Video Status */}
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                      <StatusDot status={vidStatus} /> vid
                      {vidStatus === 'COMPLETED' && vidUrl && (
                        <button
                          onClick={() => handleDownloadMedia(scene, 'video')}
                          disabled={downloadingSceneId === scene.id && downloadingType === 'video'}
                          title="Tải video này"
                          className="p-0.5 rounded hover:bg-opacity-20 hover:bg-blue-500 transition-colors"
                          style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {downloadingSceneId === scene.id && downloadingType === 'video' ? (
                            <Loader2 size={10} className="spin" />
                          ) : (
                            <Download size={10} />
                          )}
                        </button>
                      )}
                    </span>

                    {/* Upscale Status */}
                    <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                      <StatusDot status={upscaleStatus} /> upscale
                      {upscaleStatus === 'COMPLETED' && upscaleUrl && (
                        <button
                          onClick={() => handleDownloadMedia(scene, 'upscale')}
                          disabled={downloadingSceneId === scene.id && downloadingType === 'upscale'}
                          title="Tải video 4K này"
                          className="p-0.5 rounded hover:bg-opacity-20 hover:bg-blue-500 transition-colors"
                          style={{ color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                        >
                          {downloadingSceneId === scene.id && downloadingType === 'upscale' ? (
                            <Loader2 size={10} className="spin" />
                          ) : (
                            <Download size={10} />
                          )}
                        </button>
                      )}
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>NỘI DUNG CẢNH</div>
                  <EditableText
                    value={scene.prompt ?? ''}
                    onSave={v => patchScene(scene.id, 'prompt', v)}
                    className="text-xs"
                  />
                </div>

                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>NỘI DUNG VIDEO</div>
                  <EditableText
                    value={scene.video_prompt ?? ''}
                    onSave={v => patchScene(scene.id, 'video_prompt', v)}
                    multiline
                    className="text-xs"
                  />
                </div>

                {charNames.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {charNames.map(name => (
                      <span key={name} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--accent)' }}>
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- Main ProjectDetailPage ----
export default function ProjectDetailPage({ projectId, onBack, onGoStudio }: Props) {
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [tab, setTab] = useState<Tab>('Tổng quan')
  const [loading, setLoading] = useState(true)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [videoToDelete, setVideoToDelete] = useState<Video | null>(null)
  const [deletingVideo, setDeletingVideo] = useState(false)

  const fetchAll = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetchAPI<Project>(`/api/projects/${projectId}`),
      fetchAPI<Character[]>(`/api/projects/${projectId}/characters`),
      fetchAPI<Video[]>(`/api/videos?project_id=${projectId}`),
    ])
      .then(([proj, chars, vids]) => {
        setProject(proj)
        setCharacters(chars)
        setVideos(vids)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [projectId])

  useEffect(() => { fetchAll() }, [fetchAll])

  async function handleDelete() {
    setDeleting(true)
    try {
      await deleteAPI(`/api/projects/${projectId}`)
      onBack()
    } catch (e) {
      console.error(e)
      setDeleting(false)
      setShowDeleteModal(false)
    }
  }

  async function handleDeleteVideo() {
    if (!videoToDelete) return
    setDeletingVideo(true)
    try {
      await deleteAPI(`/api/videos/${videoToDelete.id}`)
      setVideoToDelete(null)
      fetchAll()
    } catch (e) {
      console.error(e)
    } finally {
      setDeletingVideo(false)
    }
  }

  if (loading || !project) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>Đang tải dự án...</div>
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'Tổng quan', label: 'Tổng quan' },
    { key: 'Nhân vật', label: `Nhân vật (${characters.length})` },
    { key: 'Video', label: `Video (${videos.length})` },
    { key: 'Cảnh', label: 'Cảnh' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Back + title + actions */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-xs px-3 py-1.5 rounded"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          ← Quay lại
        </button>
        <h1 className="font-bold text-sm flex-1 truncate" style={{ color: 'var(--text)' }}>{project.name}</h1>
        <div className="flex gap-2 flex-shrink-0">
          {onGoStudio && (
            <button
              onClick={() => onGoStudio(projectId)}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-semibold"
              style={{ background: 'var(--accent)', color: '#fff', border: 'none' }}
            >
              <Clapperboard size={12} /> Studio
            </button>
          )}
          <button
            onClick={() => setShowDeleteModal(true)}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-semibold"
            style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            <Trash2 size={12} /> Xóa
          </button>
        </div>
      </div>

      {/* Delete confirm modal */}
      {showDeleteModal && (
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
              <span className="font-bold text-sm" style={{ color: 'var(--text)' }}>Xóa dự án?</span>
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Bạn sắp xóa dự án <strong style={{ color: 'var(--text)' }}>"{project.name}"</strong>.
              Hành động này sẽ xóa toàn bộ video, cảnh, nhân vật của dự án. Không thể hoàn tác.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowDeleteModal(false)}
                className="text-xs px-4 py-2 rounded"
                style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
              >
                Hủy
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex items-center gap-1.5 text-xs px-4 py-2 rounded font-semibold"
                style={{ background: 'var(--red)', color: '#fff', opacity: deleting ? 0.6 : 1 }}
              >
                <Trash2 size={12} /> {deleting ? 'Đang xóa...' : 'Xác nhận xóa'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete video confirm modal */}
      {videoToDelete && (
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
              Bạn sắp xóa tập video <strong style={{ color: 'var(--text)' }}>"{videoToDelete.title}"</strong>.
              Hành động này sẽ xóa toàn bộ các cảnh và tiến trình của tập này. Không thể hoàn tác.
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setVideoToDelete(null)}
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

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className="px-3 py-1.5 rounded-t text-xs font-semibold transition-colors"
            style={{
              background: tab === key ? 'var(--card)' : 'transparent',
              color: tab === key ? 'var(--accent)' : 'var(--muted)',
              borderBottom: tab === key ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'Tổng quan' && <OverviewTab project={project} onRefresh={fetchAll} />}
        {tab === 'Nhân vật' && <CharactersTab characters={characters} onRefresh={fetchAll} />}
        {tab === 'Video' && <VideosTab videos={videos} project={project} onDeleteVideo={setVideoToDelete} onViewVideo={(vid) => navigate(`/videos/${vid}`)} />}
        {tab === 'Cảnh' && <ScenesTab videos={videos} projectName={project.name} />}
      </div>
    </div>
  )
}
