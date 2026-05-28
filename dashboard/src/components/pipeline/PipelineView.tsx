import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Image as ImageIcon, Film, Zap, Users, RefreshCw, RotateCcw,
  CheckCircle, XCircle, Play, X, Loader2, ChevronDown, ChevronUp,
  Mic, User, MapPin, Download, PackageOpen,
} from 'lucide-react'
import { fetchAPI, postAPI } from '../../api/client'
import { useWebSocket } from '../../api/useWebSocket'
import { useDownload, buildFilename } from '../../api/useDownload'
import type { Character, Scene, StatusType } from '../../types'

interface PipelineViewProps {
  projectId: string
  videoId: string
  orientation?: string
  projectName?: string
}

// ── Status helpers ─────────────────────────────────────────
const STATUS_COLOR: Record<StatusType, string> = {
  COMPLETED:  'var(--green)',
  PROCESSING: 'var(--yellow)',
  PENDING:    'var(--muted)',
  FAILED:     'var(--red)',
}

const STATUS_LABEL: Record<StatusType, string> = {
  COMPLETED:  '✓',
  PROCESSING: '⟳',
  PENDING:    '–',
  FAILED:     '✗',
}

function getSceneData(scene: Scene, ori: string) {
  const o = ori.toLowerCase()
  return {
    imageStatus:  scene[`${o}_image_status`  as keyof Scene] as StatusType ?? 'PENDING',
    imageUrl:     scene[`${o}_image_url`      as keyof Scene] as string | null,
    videoStatus:  scene[`${o}_video_status`   as keyof Scene] as StatusType ?? 'PENDING',
    videoUrl:     scene[`${o}_video_url`      as keyof Scene] as string | null,
    upscaleStatus:scene[`${o}_upscale_status` as keyof Scene] as StatusType ?? 'PENDING',
    upscaleUrl:   scene[`${o}_upscale_url`    as keyof Scene] as string | null,
  }
}

// ── Video preview modal ────────────────────────────────────
function VideoModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)' }}
    >
      <div className="relative flex flex-col items-center gap-3" style={{ maxWidth: 440, width: '92%' }}>
        <button
          onClick={onClose}
          className="absolute -top-9 right-0 flex items-center gap-1 text-xs rounded px-2 py-1"
          style={{ color: 'var(--muted)', background: 'rgba(255,255,255,0.08)' }}
        >
          <X size={13} /> Đóng
        </button>
        <video
          src={url}
          controls
          autoPlay
          playsInline
          className="rounded-xl w-full"
          style={{ maxHeight: '72vh', background: '#000' }}
        />
      </div>
    </div>
  )
}

// ── Image Lightbox modal ────────────────────────────────────
function ImageLightboxModal({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.92)' }}
    >
      <div className="relative flex flex-col items-center gap-3" style={{ maxWidth: 800, width: '94%' }}>
        <button
          onClick={onClose}
          className="absolute -top-9 right-0 flex items-center gap-1 text-xs rounded px-2 py-1"
          style={{ color: 'var(--muted)', background: 'rgba(255,255,255,0.08)' }}
        >
          <X size={13} /> Đóng
        </button>
        <img
          src={url}
          alt="Scene image"
          className="rounded-xl"
          style={{ maxHeight: '82vh', maxWidth: '100%', objectFit: 'contain', boxShadow: '0 8px 48px rgba(0,0,0,0.7)' }}
        />
      </div>
    </div>
  )
}

// ── Status badge ──────────────────────────────────────────
function StatusBadge({ status, label }: { status: StatusType; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold"
      style={{
        background: STATUS_COLOR[status] + '18',
        color: STATUS_COLOR[status],
        border: `1px solid ${STATUS_COLOR[status]}44`,
      }}
    >
      {STATUS_LABEL[status]} {label}
    </span>
  )
}

// ── Media Placeholder ──────────────────────────────────────
function MediaPlaceholder({
  type,
  status,
  onClick,
  onCancel,
}: {
  type: 'image' | 'video'
  status: StatusType
  onClick?: () => void
  onCancel?: () => void
}) {
  const isProcessing = status === 'PROCESSING' || status === 'PENDING'
  return (
    <div
      className="flex flex-col items-center justify-center gap-2 rounded-lg cursor-pointer transition-all relative"
      style={{
        background: status === 'FAILED' ? 'rgba(239,68,68,0.06)' : 'var(--surface)',
        border: `1.5px dashed ${
          status === 'FAILED' ? 'rgba(239,68,68,0.4)'
          : isProcessing ? 'var(--accent)'
          : 'var(--border)'
        }`,
        width: '100%',
        height: '100%',
        minHeight: 120,
      }}
      onClick={isProcessing ? undefined : onClick}
    >
      {isProcessing ? (
        <div className="flex flex-col items-center gap-2 p-2 w-full text-center">
          <Loader2 size={18} className="spin" style={{ color: 'var(--accent)' }} />
          <span style={{ color: 'var(--accent)', fontSize: 10, fontWeight: 'bold' }}>
            {status === 'PROCESSING' ? 'Đang tạo...' : 'Đang chờ...'}
          </span>
          {onCancel && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCancel()
              }}
              className="mt-1 px-2 py-0.5 text-[10px] font-semibold rounded border flex items-center gap-0.5 transition-all hover:bg-[rgba(239,68,68,0.15)]"
              style={{
                color: 'var(--red)',
                borderColor: 'rgba(239,68,68,0.4)',
                background: 'rgba(239,68,68,0.08)'
              }}
            >
              <XCircle size={10} /> Hủy bỏ
            </button>
          )}
        </div>
      ) : (
        <span className="text-xs" style={{ color: status === 'FAILED' ? 'var(--red)' : 'var(--muted)' }}>
          {status === 'FAILED' ? 'Lỗi tạo'
          : (status as string) === 'PENDING' ? `Chờ tạo ${type === 'image' ? 'ảnh' : 'video'}`
          : 'Chưa có'}
        </span>
      )}
    </div>
  )
}

// ── Scene Row ─────────────────────────────────────────────
function SceneRow({
  scene, chars, projectId, videoId, orientation, onRefresh, projectName,
}: {
  scene: Scene
  chars: Character[]
  projectId: string
  videoId: string
  orientation: string
  onRefresh: () => void
  projectName: string
}) {
  const [videoOpen, setVideoOpen] = useState(false)
  const [imageOpen, setImageOpen] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [retrying, setRetrying] = useState<'image' | 'video' | null>(null)
  const [downloading, setDownloading] = useState<'image' | 'video' | null>(null)
  const { saveFile } = useDownload()

  const { imageStatus, imageUrl, videoStatus, videoUrl, upscaleStatus, upscaleUrl } =
    getSceneData(scene, orientation)

  // Parse character names
  let charNames: string[] = []
  try { charNames = scene.character_names ? JSON.parse(scene.character_names) : [] } catch (_) {}
  const sceneChars = chars.filter(c => charNames.includes(c.name))

  const displayVideo = upscaleUrl || videoUrl
  const displayVideoStatus: StatusType = (upscaleStatus === 'PROCESSING' || upscaleStatus === 'PENDING' || upscaleUrl) ? upscaleStatus : videoStatus

  async function retry(type: 'image' | 'video') {
    setRetrying(type)
    try {
      await postAPI('/api/requests/batch', {
        requests: [{
          type: type === 'image' ? 'REGENERATE_IMAGE' : 'GENERATE_VIDEO',
          scene_id: scene.id,
          project_id: projectId,
          video_id: videoId,
          orientation: orientation.toUpperCase(),
        }]
      })
      onRefresh()
    } catch (_) {}
    finally { setRetrying(null) }
  }

  async function cancelActiveRequest(type: 'GENERATE_IMAGE' | 'GENERATE_VIDEO' | 'UPSCALE_VIDEO') {
    try {
      await postAPI(`/api/requests/cancel-active?scene_id=${scene.id}&type=${type}&orientation=${orientation}`, {})
      onRefresh()
    } catch (e) {
      console.error("Failed to cancel active request:", e)
    }
  }

  async function downloadMedia(type: 'image' | 'video') {
    const url = type === 'image' ? imageUrl : displayVideo
    if (!url) return
    setDownloading(type)
    try {
      const ext = type === 'image' ? 'jpg' : 'mp4'
      await saveFile({
        url,
        filename: buildFilename(scene.display_order, type === 'image' ? 'image' : (upscaleUrl ? 'upscale' : 'video'), ext),
        projectName,
        sceneName: `canh-${scene.display_order + 1}`,
      })
    } finally {
      setDownloading(null)
    }
  }

  const hasPrompts = scene.prompt || scene.image_prompt || scene.video_prompt || scene.narrator_text

  return (
    <>
      {videoOpen && displayVideo && (
        <VideoModal url={displayVideo} onClose={() => setVideoOpen(false)} />
      )}
      {imageOpen && imageUrl && (
        <ImageLightboxModal url={imageUrl} onClose={() => setImageOpen(false)} />
      )}

      <div
        className="rounded-xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--card)',
          border: `1px solid ${
            imageStatus === 'FAILED' || videoStatus === 'FAILED'
              ? 'rgba(239,68,68,0.3)'
              : 'var(--border)'
          }`,
          flexShrink: 0,
        }}
      >
        {/* Top bar: scene number + status badges */}
        <div
          className="flex items-center gap-2 px-3 py-2"
          style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface)' }}
        >
          <span className="font-bold text-xs" style={{ color: 'var(--accent)' }}>
            Cảnh #{scene.display_order + 1}
          </span>
          <span
            className="text-xs px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(124,91,245,0.1)', color: 'var(--muted)', fontSize: 10 }}
          >
            {scene.chain_type}
          </span>

          {/* Char avatars */}
          {sceneChars.length > 0 && (
            <div className="flex items-center gap-1 ml-1">
              {sceneChars.map(c => (
                <div
                  key={c.id}
                  className="flex items-center gap-1 rounded px-1 py-0.5"
                  style={{ background: 'rgba(124,91,245,0.08)', fontSize: 10, color: 'var(--muted)' }}
                >
                  {c.entity_type === 'location' ? <MapPin size={9} /> : <User size={9} />}
                  {c.name}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1 ml-auto">
            <StatusBadge status={imageStatus} label="Ảnh" />
            <StatusBadge status={displayVideoStatus} label="Video" />
          </div>
        </div>

        {/* Main media row: image LEFT | video RIGHT */}
        <div className="flex gap-3 p-3" style={{ minHeight: 160 }}>
          {/* LEFT: Image */}
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
              <ImageIcon size={10} /> Ảnh cảnh
              {imageUrl && imageStatus === 'COMPLETED' && (
                <button
                  onClick={() => downloadMedia('image')}
                  disabled={downloading === 'image'}
                  title="Tải ảnh"
                  className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5"
                  style={{ background: 'rgba(124,91,245,0.1)', color: 'var(--accent)', fontSize: 9 }}
                >
                  {downloading === 'image' ? <Loader2 size={9} className="spin" /> : <Download size={9} />}
                </button>
              )}
            </div>
            <div
              style={{ flex: 1, aspectRatio: orientation === 'VERTICAL' ? '9/16' : '16/9', maxHeight: 200, cursor: imageUrl ? 'zoom-in' : 'default' }}
              onClick={() => imageUrl && setImageOpen(true)}
              title={imageUrl ? 'Click để xem ảnh lớn' : undefined}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  alt={`Scene ${scene.display_order + 1}`}
                  className="w-full h-full object-cover rounded-lg"
                  style={{ display: 'block', transition: 'opacity 0.15s' }}
                />
              ) : (
                <MediaPlaceholder type="image" status={imageStatus} onCancel={() => cancelActiveRequest('GENERATE_IMAGE')} />
              )}
            </div>
            {imageStatus === 'FAILED' && (
              <button
                onClick={() => retry('image')}
                disabled={retrying === 'image'}
                className="flex items-center justify-center gap-1 rounded py-1 text-xs"
                style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                {retrying === 'image' ? <Loader2 size={10} className="spin" /> : <RotateCcw size={10} />}
                Thử lại ảnh
              </button>
            )}
          </div>

          {/* RIGHT: Video */}
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="text-xs flex items-center gap-1" style={{ color: 'var(--muted)' }}>
              <Film size={10} /> Video cảnh
              {upscaleUrl && <Zap size={9} style={{ color: 'var(--yellow)' }} />}
              {displayVideo && displayVideoStatus === 'COMPLETED' && (
                <button
                  onClick={() => downloadMedia('video')}
                  disabled={downloading === 'video'}
                  title="Tải video"
                  className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5"
                  style={{ background: 'rgba(124,91,245,0.1)', color: 'var(--accent)', fontSize: 9 }}
                >
                  {downloading === 'video' ? <Loader2 size={9} className="spin" /> : <Download size={9} />}
                </button>
              )}
            </div>
            <div
              style={{ flex: 1, aspectRatio: orientation === 'VERTICAL' ? '9/16' : '16/9', maxHeight: 200, position: 'relative' }}
            >
              {displayVideo ? (
                <div
                  className="relative w-full h-full rounded-lg overflow-hidden cursor-pointer group"
                  onClick={() => setVideoOpen(true)}
                >
                  {/* Video thumbnail from image */}
                  {imageUrl && (
                    <img
                      src={imageUrl}
                      alt="video thumb"
                      className="w-full h-full object-cover"
                    />
                  )}
                  <div
                    className="absolute inset-0 flex items-center justify-center transition-all"
                    style={{ background: 'rgba(0,0,0,0.45)' }}
                  >
                    {upscaleStatus === 'PROCESSING' || upscaleStatus === 'PENDING' ? (
                      <div className="flex flex-col items-center gap-1.5 p-2 w-full text-center">
                        <Loader2 size={16} className="spin" style={{ color: 'var(--yellow)' }} />
                        <span style={{ color: 'var(--yellow)', fontSize: 10, fontWeight: 'bold' }}>
                          {upscaleStatus === 'PROCESSING' ? 'Đang upscale 4K...' : 'Chờ upscale 4K...'}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            cancelActiveRequest('UPSCALE_VIDEO')
                          }}
                          className="px-2 py-0.5 text-[9px] font-semibold rounded border flex items-center gap-0.5 transition-all hover:bg-[rgba(239,68,68,0.15)]"
                          style={{
                            color: 'var(--red)',
                            borderColor: 'rgba(239,68,68,0.4)',
                            background: 'rgba(239,68,68,0.08)'
                          }}
                        >
                          <XCircle size={8} /> Hủy upscale
                        </button>
                      </div>
                    ) : (
                      <div
                        className="flex items-center justify-center rounded-full"
                        style={{ width: 40, height: 40, background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)' }}
                      >
                        <Play size={18} color="#fff" fill="#fff" />
                      </div>
                    )}
                  </div>
                  {upscaleUrl && (
                    <div
                      className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded px-1 py-0.5"
                      style={{ background: 'rgba(0,0,0,0.7)', fontSize: 9, color: 'var(--yellow)' }}
                    >
                      <Zap size={8} /> 4K
                    </div>
                  )}
                </div>
              ) : (
                <MediaPlaceholder
                  type="video"
                  status={displayVideoStatus}
                  onClick={() => {}}
                  onCancel={() => cancelActiveRequest(videoStatus === 'PROCESSING' || videoStatus === 'PENDING' ? 'GENERATE_VIDEO' : 'UPSCALE_VIDEO')}
                />
              )}
            </div>
            {videoStatus === 'FAILED' && (
              <button
                onClick={() => retry('video')}
                disabled={retrying === 'video'}
                className="flex items-center justify-center gap-1 rounded py-1 text-xs"
                style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.3)' }}
              >
                {retrying === 'video' ? <Loader2 size={10} className="spin" /> : <RotateCcw size={10} />}
                Thử lại video
              </button>
            )}
          </div>
        </div>

        {/* Narrator text */}
        {scene.narrator_text && (
          <div
            className="mx-3 mb-2 px-2 py-1.5 rounded text-xs"
            style={{ background: 'rgba(124,91,245,0.06)', border: '1px solid rgba(124,91,245,0.15)', color: 'var(--muted)', lineHeight: 1.5 }}
          >
            <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: 10 }}>
              <Mic size={9} style={{ display: 'inline', marginRight: 3 }} />
              Lời dẫn:{' '}
            </span>
            {scene.narrator_text}
          </div>
        )}

        {/* Prompt section (expand) */}
        {hasPrompts && (
          <div className="px-3 pb-2">
            <button
              onClick={() => setPromptOpen(!promptOpen)}
              className="flex items-center gap-1 text-xs w-full"
              style={{ color: 'var(--muted)' }}
            >
              {promptOpen ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              {promptOpen ? 'Ẩn prompt' : 'Xem prompt'}
            </button>
            {promptOpen && (
              <div className="flex flex-col gap-1.5 mt-1.5">
                {scene.prompt && (
                  <div className="rounded p-2 text-xs" style={{ background: 'var(--surface)', color: 'var(--muted)', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>📜 Cảnh: </span>
                    {scene.prompt}
                  </div>
                )}
                {scene.image_prompt && (
                  <div className="rounded p-2 text-xs" style={{ background: 'var(--surface)', color: 'var(--muted)', lineHeight: 1.5 }}>
                    <span className="flex items-center gap-1" style={{ color: 'var(--text)', fontWeight: 600 }}><ImageIcon size={10} /> Ảnh: </span>
                    {scene.image_prompt}
                  </div>
                )}
                {scene.video_prompt && (
                  <div className="rounded p-2 text-xs" style={{ background: 'var(--surface)', color: 'var(--muted)', lineHeight: 1.5 }}>
                    <span className="flex items-center gap-1" style={{ color: 'var(--text)', fontWeight: 600 }}><Film size={10} /> Video: </span>
                    {scene.video_prompt}
                  </div>
                )}
                {sceneChars.length > 0 && (
                  <div className="rounded p-2 text-xs" style={{ background: 'var(--surface)', color: 'var(--muted)', lineHeight: 1.5 }}>
                    <span className="flex items-center gap-1" style={{ color: 'var(--text)', fontWeight: 600 }}><Users size={10} /> Nhân vật: </span>
                    {sceneChars.map(c => c.name).join(', ')}
                    {sceneChars.map(c => c.image_prompt).filter(Boolean).map((p, i) => (
                      <div key={i} className="mt-1 pl-2" style={{ borderLeft: '2px solid var(--border)' }}>
                        {p}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}

// ── Character Ref Grid ─────────────────────────────────────
function CharRefsPanel({ chars }: { chars: Character[] }) {
  if (!chars.length) return null
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
        Ảnh tham chiếu — {chars.length} nhân vật/địa điểm
      </div>
      <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))' }}>
        {chars.map(c => (
          <div
            key={c.id}
            className="flex flex-col gap-1.5 p-2 rounded-lg text-xs"
            style={{
              background: 'var(--card)',
              border: `1px solid ${c.media_id ? 'var(--border)' : 'rgba(239,68,68,0.3)'}`,
            }}
          >
            <div
              className="w-full rounded overflow-hidden flex items-center justify-center"
              style={{ aspectRatio: '3/4', background: 'var(--surface)', maxHeight: 90 }}
            >
              {c.reference_image_url ? (
                <img src={c.reference_image_url} alt={c.name} className="w-full h-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1">
                  {c.entity_type === 'location' ? <MapPin size={16} style={{ color: 'var(--muted)' }} /> : <User size={16} style={{ color: 'var(--muted)' }} />}
                  <span style={{ color: 'var(--muted)', fontSize: 9 }}>Chưa có</span>
                </div>
              )}
            </div>
            <div className="font-semibold truncate" style={{ color: 'var(--text)' }}>{c.name}</div>
            <div className="flex items-center gap-1">
              {c.media_id
                ? <CheckCircle size={9} color="var(--green)" />
                : <XCircle size={9} color="var(--red)" />
              }
              <span style={{ color: c.media_id ? 'var(--green)' : 'var(--red)', fontSize: 9 }}>
                {c.media_id ? 'Sẵn sàng' : 'Cần ảnh'}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Pipeline Summary Bar ───────────────────────────────────
function SummaryBar({
  chars, scenes, orientation, onRetryAll, onDownloadAll,
}: {
  chars: Character[]
  scenes: Scene[]
  orientation: string
  onRetryAll: (stage: 'image' | 'video') => void
  onDownloadAll: (type: 'images' | 'videos' | 'all') => void
}) {
  const ori = orientation.toLowerCase()
  const imgDone  = scenes.filter(s => (s[`${ori}_image_status`  as keyof Scene] as StatusType) === 'COMPLETED').length
  const imgFail  = scenes.filter(s => (s[`${ori}_image_status`  as keyof Scene] as StatusType) === 'FAILED').length
  const vidDone  = scenes.filter(s => (s[`${ori}_video_status`  as keyof Scene] as StatusType) === 'COMPLETED').length
  const vidFail  = scenes.filter(s => (s[`${ori}_video_status`  as keyof Scene] as StatusType) === 'FAILED').length
  const refDone  = chars.filter(c => c.media_id).length
  const total    = scenes.length
  const [downloading, setDownloading] = useState<string | null>(null)

  const stats = [
    { label: 'Refs', done: refDone, total: chars.length, color: 'var(--accent)' },
    { label: 'Ảnh',  done: imgDone, total, color: 'var(--green)', failed: imgFail, stage: 'image' as const },
    { label: 'Video', done: vidDone, total, color: 'var(--yellow)', failed: vidFail, stage: 'video' as const },
  ]

  async function handleDownloadAll(type: 'images' | 'videos' | 'all') {
    setDownloading(type)
    try { await onDownloadAll(type) } finally { setDownloading(null) }
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl px-4 py-3"
      style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
    >
      {/* Stats row */}
      <div className="flex items-center gap-3">
        {stats.map(st => (
          <div key={st.label} className="flex flex-col gap-1 flex-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold" style={{ color: st.color }}>{st.label}</span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {st.done}/{st.total}
              </span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--surface)' }}>
              <div
                style={{
                  height: '100%',
                  width: st.total > 0 ? `${Math.round(st.done / st.total * 100)}%` : '0%',
                  background: st.color,
                  transition: 'width 0.5s',
                }}
              />
            </div>
            {st.failed && st.failed > 0 && st.stage && (
              <button
                onClick={() => onRetryAll(st.stage!)}
                className="flex items-center gap-1 text-xs rounded px-1.5 py-0.5 self-start"
                style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.25)' }}
              >
                <RotateCcw size={9} /> Retry {st.failed} lỗi
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Batch download row */}
      {(imgDone > 0 || vidDone > 0) && (
        <div className="flex items-center gap-2 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <PackageOpen size={11} style={{ color: 'var(--muted)' }} />
          <span className="text-xs" style={{ color: 'var(--muted)' }}>Tải hàng loạt:</span>
          {imgDone > 0 && (
            <button
              onClick={() => handleDownloadAll('images')}
              disabled={!!downloading}
              className="flex items-center gap-1 text-xs rounded px-2 py-0.5"
              style={{ background: 'rgba(34,197,94,0.1)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.25)' }}
            >
              {downloading === 'images' ? <Loader2 size={9} className="spin" /> : <Download size={9} />}
              {imgDone} ảnh
            </button>
          )}
          {vidDone > 0 && (
            <button
              onClick={() => handleDownloadAll('videos')}
              disabled={!!downloading}
              className="flex items-center gap-1 text-xs rounded px-2 py-0.5"
              style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--yellow)', border: '1px solid rgba(245,158,11,0.25)' }}
            >
              {downloading === 'videos' ? <Loader2 size={9} className="spin" /> : <Download size={9} />}
              {vidDone} video
            </button>
          )}
          {imgDone > 0 && vidDone > 0 && (
            <button
              onClick={() => handleDownloadAll('all')}
              disabled={!!downloading}
              className="flex items-center gap-1 text-xs rounded px-2 py-0.5"
              style={{ background: 'rgba(124,91,245,0.1)', color: 'var(--accent)', border: '1px solid rgba(124,91,245,0.25)' }}
            >
              {downloading === 'all' ? <Loader2 size={9} className="spin" /> : <Download size={9} />}
              Tất cả ({imgDone + vidDone})
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main PipelineView ──────────────────────────────────────
export default function PipelineView({ projectId, videoId, orientation = 'VERTICAL', projectName = '' }: PipelineViewProps) {
  const [chars, setChars]   = useState<Character[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(true)
  const [showRefs, setShowRefs] = useState(false)
  const { lastEvent } = useWebSocket()
  const scrollRef = useRef<HTMLDivElement>(null)
  const { saveBatch } = useDownload()

  const load = useCallback(async () => {
    try {
      const [c, s] = await Promise.all([
        fetchAPI<Character[]>(`/api/projects/${projectId}/characters`),
        fetchAPI<Scene[]>(`/api/scenes?video_id=${videoId}`),
      ])
      setChars(c)
      setScenes(s.sort((a, b) => a.display_order - b.display_order))
    } catch (_) {}
    finally { setLoading(false) }
  }, [projectId, videoId])

  // Reset when switching videos to avoid showing stale data from previous video
  useEffect(() => {
    setLoading(true)
    setScenes([])
  }, [videoId])

  useEffect(() => { load() }, [load])


  useEffect(() => {
    if (!lastEvent) return
    const t = lastEvent.type
    if (['scene_updated', 'character_updated', 'request_completed', 'request_failed', 'urls_refreshed'].includes(t)) {
      load()
    }
  }, [lastEvent, load])

  async function retryAllFailed(stage: 'image' | 'video') {
    const ori = orientation.toLowerCase()
    const statusKey = `${ori}_${stage}_status` as keyof Scene
    const failed = scenes.filter(s => (s[statusKey] as StatusType) === 'FAILED')
    if (!failed.length) return
    const typeMap = { image: 'REGENERATE_IMAGE', video: 'GENERATE_VIDEO' }
    await postAPI('/api/requests/batch', {
      requests: failed.map(s => ({
        type: typeMap[stage],
        scene_id: s.id,
        project_id: projectId,
        video_id: videoId,
        orientation: orientation.toUpperCase(),
      }))
    })
    load()
  }

  async function downloadAll(type: 'images' | 'videos' | 'all') {
    const ori = orientation.toLowerCase()
    const items: { url: string; filename: string; projectName: string }[] = []
    for (const scene of scenes) {
      const imgUrl = scene[`${ori}_image_url` as keyof Scene] as string | null
      const vidUrl = (scene[`${ori}_upscale_url` as keyof Scene] || scene[`${ori}_video_url` as keyof Scene]) as string | null
      if ((type === 'images' || type === 'all') && imgUrl) {
        items.push({ url: imgUrl, filename: buildFilename(scene.display_order, 'image', 'jpg'), projectName })
      }
      if ((type === 'videos' || type === 'all') && vidUrl) {
        const isUpscale = !!(scene[`${ori}_upscale_url` as keyof Scene])
        items.push({ url: vidUrl, filename: buildFilename(scene.display_order, isUpscale ? 'upscale' : 'video', 'mp4'), projectName })
      }
    }
    if (items.length) await saveBatch({ items, projectName })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8">
        <Loader2 size={16} className="spin" style={{ color: 'var(--muted)' }} />
        <span className="text-xs" style={{ color: 'var(--muted)' }}>Đang tải dữ liệu...</span>
      </div>
    )
  }

  if (!scenes.length) {
    return (
      <div className="flex flex-col items-center gap-2 py-12">
        <Film size={32} style={{ color: 'var(--border)' }} />
        <span className="text-xs" style={{ color: 'var(--muted)' }}>Chưa có cảnh nào. Hãy dùng AI để viết kịch bản!</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Summary bar with progress + retry + batch download */}
      <SummaryBar
        chars={chars}
        scenes={scenes}
        orientation={orientation}
        onRetryAll={retryAllFailed}
        onDownloadAll={downloadAll}
      />

      {/* Refs toggle */}
      {chars.length > 0 && (
        <button
          onClick={() => setShowRefs(v => !v)}
          className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg self-start"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          <Users size={11} />
          {showRefs ? 'Ẩn' : 'Xem'} ảnh tham chiếu ({chars.length} nhân vật)
          {showRefs ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      )}

      {showRefs && <CharRefsPanel chars={chars} />}

      {/* Refresh button */}
      <div className="flex items-center gap-2">
        <button
          onClick={load}
          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          <RefreshCw size={11} /> Làm mới
        </button>
        <span className="text-xs" style={{ color: 'var(--muted)' }}>
          {scenes.length} cảnh • {orientation}
        </span>
      </div>

      {/* Scene list — smooth scroll */}
      <div
        ref={scrollRef}
        className="flex flex-col gap-3 overflow-y-auto"
        style={{
          maxHeight: 'calc(100vh - 340px)',
          scrollBehavior: 'smooth',
          paddingRight: 2,
        }}
      >
        {scenes.map(scene => (
          <SceneRow
            key={scene.id}
            scene={scene}
            chars={chars}
            projectId={projectId}
            videoId={videoId}
            orientation={orientation}
            onRefresh={load}
            projectName={projectName}
          />
        ))}
      </div>
    </div>
  )
}
