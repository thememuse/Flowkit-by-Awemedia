import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchAPI, postAPI } from '../api/client'
import type { Video, Scene, Project } from '../types'
import {
  ArrowLeft, Clapperboard, Film, Volume2,
  Sparkles, Download, Copy, Play, Check, ChevronRight, Loader2, Sparkle
} from 'lucide-react'
import { useDownload } from '../api/useDownload'
import { useWebSocket } from '../api/useWebSocket'

export default function VideoDetailPage() {
  const { vid } = useParams<{ vid: string }>()
  const navigate = useNavigate()
  const { saveFile } = useDownload()
  
  const [video, setVideo] = useState<Video | null>(null)
  const [project, setProject] = useState<Project | null>(null)
  const [scenes, setScenes] = useState<Scene[]>([])
  const [selectedSceneId, setSelectedSceneId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [downloadingSceneId, setDownloadingSceneId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<'image' | 'video' | 'upscale' | null>(null)
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null)

  function showToast(message: string, type: 'success' | 'error' | 'info' = 'success') {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  async function triggerManualGeneration(type: 'image' | 'video' | 'upscale') {
    console.log(`[FlowKit] triggerManualGeneration called: type=${type}`);
    console.log(`[FlowKit] Active states: selectedSceneId=${selectedSceneId}, hasProject=${!!project}, hasVideo=${!!video}`);

    if (!selectedSceneId) {
      showToast("Chưa chọn phân cảnh để sản xuất!", "error");
      return;
    }
    if (!video) {
      showToast("Dữ liệu tập phim chưa sẵn sàng!", "error");
      return;
    }
    if (!project) {
      showToast("Dữ liệu dự án chưa sẵn sàng!", "error");
      return;
    }

    const currentScene = scenes.find(s => s.id === selectedSceneId)
    if (!currentScene) {
      showToast("Không tìm thấy thông tin phân cảnh này!", "error");
      return;
    }

    setActionLoading(type)
    try {
      const orientation = video.orientation ?? 'VERTICAL'
      let reqType = ''
      if (type === 'image') {
        reqType = 'GENERATE_IMAGE'
      } else if (type === 'video') {
        reqType = 'GENERATE_VIDEO'
      } else if (type === 'upscale') {
        reqType = 'UPSCALE_VIDEO'
      }

      console.log(`[FlowKit] Submitting Batch Request: type=${reqType}, scene_id=${currentScene.id}, project_id=${project.id}, video_id=${video.id}`);

      const response = await postAPI<any>('/api/requests/batch', {
        requests: [{
          type: reqType,
          scene_id: currentScene.id,
          project_id: project.id,
          video_id: video.id,
          orientation: orientation.toUpperCase(),
        }]
      })

      console.log(`[FlowKit] Batch request submitted successfully:`, response);
      showToast(`Đã thêm yêu cầu tạo ${type === 'image' ? 'ảnh' : type === 'video' ? 'video' : 'upscale 4K'} vào hàng chờ!`, "success");
      
      // Auto silent refresh list
      loadData(true)
    } catch (err) {
      console.error(`[FlowKit] Failed to trigger ${type} generation:`, err)
      showToast(`Lỗi: ${err instanceof Error ? err.message : 'Không thể gửi yêu cầu'}`, "error");
    } finally {
      setActionLoading(null)
    }
  }

  // Listen to WebSocket events to auto-reload scene statuses on updates
  useWebSocket()

  function loadData(silent = false) {
    if (!vid) return
    if (!silent) setLoading(true)
    fetchAPI<Video>(`/api/videos/${vid}`)
      .then(v => {
        setVideo(v)
        // Fetch project metadata
        fetchAPI<Project>(`/api/projects/${v.project_id}`)
          .then(setProject)
          .catch(console.error)
        
        // Fetch scenes
        fetchAPI<Scene[]>(`/api/scenes?video_id=${vid}`)
          .then(scs => {
            const sorted = [...scs].sort((a, b) => a.display_order - b.display_order)
            setScenes(sorted)
            if (sorted.length > 0 && !selectedSceneId) {
              setSelectedSceneId(sorted[0].id)
            }
          })
          .catch(console.error)
      })
      .catch(err => {
        console.error("Failed to load video detail:", err)
      })
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }

  useEffect(() => {
    loadData()
  }, [vid])

  // Automatically refresh when requests update in real-time
  useEffect(() => {
    if (vid) {
      const handleUpdate = () => {
        // Silent reload
        fetchAPI<Scene[]>(`/api/scenes?video_id=${vid}`)
          .then(scs => {
            const sorted = [...scs].sort((a, b) => a.display_order - b.display_order)
            setScenes(sorted)
          })
          .catch(console.error)
      }
      window.addEventListener('request_update', handleUpdate)
      window.addEventListener('urls_refreshed', handleUpdate)
      return () => {
        window.removeEventListener('request_update', handleUpdate)
        window.removeEventListener('urls_refreshed', handleUpdate)
      }
    }
  }, [vid])

  // Helper to copy text to clipboard
  function handleCopy(text: string, type: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(type)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Handle single scene asset download
  async function handleDownloadSceneAsset(scene: Scene, type: 'image' | 'video' | 'upscale') {
    if (!project) return
    const orientation = video?.orientation ?? 'VERTICAL'
    const p = orientation === 'HORIZONTAL' ? 'horizontal' : 'vertical'
    
    let url = ''
    let prefix = ''
    if (type === 'image') {
      url = scene[`${p}_image_url` as keyof Scene] as string
      prefix = 'image'
    } else if (type === 'video') {
      url = scene[`${p}_video_url` as keyof Scene] as string
      prefix = 'video'
    } else if (type === 'upscale') {
      url = scene[`${p}_upscale_url` as keyof Scene] as string
      prefix = 'upscale'
    }

    if (!url) return
    setDownloadingSceneId(`${scene.id}-${type}`)
    try {
      const ext = url.split('.').pop()?.split('?')[0] || (type === 'image' ? 'jpg' : 'mp4')
      const filename = `scene_${String(scene.display_order).padStart(3, '0')}_${scene.id}_${prefix}.${ext}`
      await saveFile({
        url,
        filename,
        projectName: project.name,
        sceneName: `scene_${scene.display_order}`,
      })
    } catch (err) {
      console.error("Failed to download scene asset:", err)
    } finally {
      setDownloadingSceneId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-3" style={{ color: 'var(--muted)' }}>
        <Loader2 size={24} className="spin text-accent" />
        <span className="text-sm">Đang tải chi tiết tập phim...</span>
      </div>
    )
  }

  if (!video) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-16 gap-3">
        <Film size={48} className="text-red opacity-60" />
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Không tìm thấy tập phim</div>
        <button className="btn btn-secondary" onClick={() => navigate('/projects')}>Quay lại danh sách</button>
      </div>
    )
  }

  const isHorizontal = video.orientation === 'HORIZONTAL'
  const prefix = isHorizontal ? 'horizontal' : 'vertical'

  const selectedScene = scenes.find(s => s.id === selectedSceneId)
  const imgStatus = selectedScene ? (isHorizontal ? selectedScene.horizontal_image_status : selectedScene.vertical_image_status) : 'PENDING'
  const vidStatus = selectedScene ? (isHorizontal ? selectedScene.horizontal_video_status : selectedScene.vertical_video_status) : 'PENDING'
  const upsStatus = selectedScene ? (isHorizontal ? selectedScene.horizontal_upscale_status : selectedScene.vertical_upscale_status) : 'PENDING'

  return (
    <div className="flex flex-col h-full overflow-hidden animate-fade-in" style={{ minHeight: 'calc(100vh - 120px)' }}>
      {/* ── Top Bar ── */}
      <div 
        className="flex items-center justify-between pb-4 mb-4 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(`/projects/${video.project_id}`)}
            className="flex items-center justify-center w-8 h-8 rounded-lg transition-all"
            style={{
              border: '1px solid var(--border)',
              background: 'var(--surface)',
            }}
            onMouseOver={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)'}
            onMouseOut={e => e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)'}
            title="Quay lại dự án"
          >
            <ArrowLeft size={16} style={{ color: 'var(--text-secondary)' }} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>{video.title}</h2>
              <span 
                className="px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide uppercase" 
                style={{ 
                  background: isHorizontal ? 'rgba(124,91,245,0.1)' : 'rgba(168,85,247,0.1)', 
                  color: isHorizontal ? 'var(--accent)' : 'var(--purple)',
                  border: `1px solid ${isHorizontal ? 'rgba(124,91,245,0.15)' : 'rgba(168,85,247,0.15)'}`
                }}
              >
                {isHorizontal ? 'Ngang (16:9)' : 'Dọc (9:16)'}
              </span>
            </div>
            {project && (
              <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                Dự án: <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{project.name}</span>
              </div>
            )}
          </div>
        </div>

        <button
          onClick={() => navigate(`/studio/${video.project_id}`)}
          className="flex items-center gap-1.5 btn btn-primary py-1.5 px-4 text-xs font-bold tracking-wide uppercase rounded-lg shadow-md hover:shadow-accent/15"
        >
          <Clapperboard size={13} />
          Mở Studio
        </button>
      </div>

      {/* ── Main Layout ── */}
      <div className="flex flex-1 gap-4 overflow-hidden min-h-0">
        
        {/* ── Left Sidebar (Scenes List) ── */}
        <div
          className="w-80 flex flex-col flex-shrink-0 rounded-xl overflow-hidden"
          style={{
            border: '1px solid var(--border)',
            background: 'var(--card)',
          }}
        >
          <div 
            className="p-3 flex items-center justify-between flex-shrink-0"
            style={{ 
              borderBottom: '1px solid var(--border)', 
              background: 'var(--surface)' 
            }}
          >
            <span className="text-xs font-extrabold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              Danh sách phân cảnh
            </span>
            <span 
              className="px-1.5 py-0.5 rounded text-[10px] font-bold" 
              style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--muted)' }}
            >
              {scenes.length} cảnh
            </span>
          </div>

          {/* Scenes Scroll Container */}
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5 scrollbar-thin">
            {scenes.map((s, idx) => {
              const isActive = s.id === selectedSceneId
              const imgUrl = isHorizontal ? s.horizontal_image_url : s.vertical_image_url
              
              const sImgSt = isHorizontal ? s.horizontal_image_status : s.vertical_image_status
              const sVidSt = isHorizontal ? s.horizontal_video_status : s.vertical_video_status
              const sUpsSt = isHorizontal ? s.horizontal_upscale_status : s.vertical_upscale_status

              return (
                <div
                  key={s.id}
                  onClick={() => setSelectedSceneId(s.id)}
                  className="flex gap-2.5 p-2 rounded-lg cursor-pointer transition-all"
                  style={{
                    border: isActive ? '1px solid rgba(79, 142, 247, 0.35)' : '1px solid transparent',
                    background: isActive ? 'rgba(79, 142, 247, 0.08)' : 'transparent',
                    boxShadow: isActive ? '0 0 12px rgba(79, 142, 247, 0.1)' : 'none',
                  }}
                  onMouseOver={e => {
                    if (!isActive) e.currentTarget.style.background = 'var(--card-hover)'
                  }}
                  onMouseOut={e => {
                    if (!isActive) e.currentTarget.style.background = 'transparent'
                  }}
                >
                  {/* Thumbnail / Index */}
                  <div 
                    className="relative w-16 h-12 flex-shrink-0 rounded overflow-hidden flex items-center justify-center"
                    style={{ 
                      border: '1px solid var(--border)',
                      background: 'var(--surface)'
                    }}
                  >
                    {imgUrl ? (
                      <img src={imgUrl} alt={`Cảnh ${s.display_order}`} className="w-full h-full object-cover" />
                    ) : (
                      <Film size={14} style={{ color: 'var(--muted)' }} />
                    )}
                    <span
                      className="absolute top-0.5 left-0.5 px-1 rounded text-[8px] font-bold"
                      style={{
                        background: 'rgba(0, 0, 0, 0.75)',
                        color: isActive ? 'var(--accent)' : 'var(--text-secondary)',
                        border: '1px solid var(--border)'
                      }}
                    >
                      #{idx + 1}
                    </span>

                    {/* Status indicator strip */}
                    <div className="absolute bottom-0.5 right-0.5 flex gap-0.5">
                      <span 
                        className="w-1.5 h-1.5 rounded-full" 
                        style={{ 
                          background: sImgSt === 'COMPLETED' ? 'var(--green)' 
                                    : sImgSt === 'PROCESSING' ? 'var(--yellow)' 
                                    : sImgSt === 'FAILED' ? 'var(--red)' : 'var(--muted)' 
                        }} 
                      />
                      <span 
                        className="w-1.5 h-1.5 rounded-full" 
                        style={{ 
                          background: sVidSt === 'COMPLETED' ? 'var(--green)' 
                                    : sVidSt === 'PROCESSING' ? 'var(--yellow)' 
                                    : sVidSt === 'FAILED' ? 'var(--red)' : 'var(--muted)' 
                        }} 
                      />
                      <span 
                        className="w-1.5 h-1.5 rounded-full" 
                        style={{ 
                          background: sUpsSt === 'COMPLETED' ? 'var(--green)' 
                                    : sUpsSt === 'PROCESSING' ? 'var(--yellow)' 
                                    : sUpsSt === 'FAILED' ? 'var(--red)' : 'var(--muted)' 
                        }} 
                      />
                    </div>
                  </div>

                  {/* Scene metadata */}
                  <div className="flex-1 flex flex-col justify-center min-w-0">
                    <div className="text-[11px] font-semibold truncate" style={{ color: isActive ? 'var(--text)' : 'var(--text-secondary)' }}>
                      {s.prompt ? s.prompt : 'Chưa có kịch bản...'}
                    </div>
                    {s.chain_type && (
                      <div className="flex items-center gap-1 mt-1">
                        <span 
                          className="text-[9px] uppercase font-bold px-1 rounded-sm" 
                          style={{ 
                            background: s.chain_type === 'ROOT' ? 'rgba(124,91,245,0.1)' : 'rgba(34,197,94,0.1)', 
                            color: s.chain_type === 'ROOT' ? 'var(--accent)' : 'var(--green)' 
                          }}
                        >
                          {s.chain_type}
                        </span>
                        <ChevronRight size={8} style={{ color: 'var(--muted)' }} />
                        <span className="text-[9px]" style={{ color: 'var(--muted)' }}>
                          {s.duration ? `${s.duration}s` : '8s'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {scenes.length === 0 && (
              <div className="text-center py-8 text-xs animate-pulse" style={{ color: 'var(--muted)' }}>
                Tập phim chưa có phân cảnh nào.
              </div>
            )}
          </div>
        </div>

        {/* ── Right Panel (Scene Details) ── */}
        <div 
          className="flex-1 flex flex-col rounded-xl overflow-hidden"
          style={{
            border: '1px solid var(--border)',
            background: 'var(--card)',
          }}
        >
          {selectedScene ? (
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4.5 scrollbar-thin">
              
              {/* ── 1. Top Section: Visual Media Player ── */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-extrabold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                    <Film size={12} className="text-accent" />
                    Trực quan phân cảnh
                  </h3>

                  {/* Individual Download Actions */}
                  <div className="flex gap-1.5">
                    {selectedScene[`${prefix}_image_url`] && (
                      <button
                        onClick={() => handleDownloadSceneAsset(selectedScene, 'image')}
                        disabled={downloadingSceneId === `${selectedScene.id}-image`}
                        className="flex items-center gap-1 text-[10px] py-1 px-2.5 rounded-lg font-bold uppercase tracking-wider transition-all"
                        style={{ 
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          color: 'var(--text-secondary)',
                        }}
                        title="Tải ảnh cảnh"
                      >
                        {downloadingSceneId === `${selectedScene.id}-image` ? <Loader2 size={10} className="spin" /> : <Download size={10} />}
                        Tải Ảnh
                      </button>
                    )}
                    {selectedScene[`${prefix}_video_url`] && (
                      <button
                        onClick={() => handleDownloadSceneAsset(selectedScene, 'video')}
                        disabled={downloadingSceneId === `${selectedScene.id}-video`}
                        className="flex items-center gap-1 text-[10px] py-1 px-2.5 rounded-lg font-bold uppercase tracking-wider transition-all"
                        style={{ 
                          border: '1px solid var(--border)',
                          background: 'var(--surface)',
                          color: 'var(--text-secondary)',
                        }}
                        title="Tải video cảnh"
                      >
                        {downloadingSceneId === `${selectedScene.id}-video` ? <Loader2 size={10} className="spin" /> : <Download size={10} />}
                        Tải Video
                      </button>
                    )}
                    {selectedScene[`${prefix}_upscale_url`] && (
                      <button
                        onClick={() => handleDownloadSceneAsset(selectedScene, 'upscale')}
                        disabled={downloadingSceneId === `${selectedScene.id}-upscale`}
                        className="flex items-center gap-1 text-[10px] py-1 px-2.5 rounded-lg font-bold uppercase tracking-wider bg-[rgba(34,197,94,0.12)] border border-[rgba(34,197,94,0.25)] hover:bg-[rgba(34,197,94,0.2)] text-green transition-all"
                        title="Tải video 4K"
                      >
                        {downloadingSceneId === `${selectedScene.id}-upscale` ? <Loader2 size={10} className="spin" /> : <Download size={10} />}
                        Tải 4K
                      </button>
                    )}
                  </div>
                </div>

                {/* Media box */}
                <div
                  className="w-full flex items-center justify-center rounded-xl overflow-hidden relative group"
                  style={{
                    aspectRatio: isHorizontal ? '16/9' : '9/16',
                    maxHeight: isHorizontal ? '380px' : '440px',
                    marginLeft: 'auto',
                    marginRight: 'auto',
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    boxShadow: 'inset 0 0 30px rgba(0,0,0,0.5)'
                  }}
                >
                  {(() => {
                    const videoUrl = selectedScene[`${prefix}_upscale_url`] || selectedScene[`${prefix}_video_url`]
                    const imgUrl = selectedScene[`${prefix}_image_url`]

                    if (videoUrl) {
                      return (
                        <video
                          key={selectedSceneId}
                          src={videoUrl}
                          controls
                          playsInline
                          preload="auto"
                          poster={imgUrl || undefined}
                          className="w-full h-full object-contain"
                        />
                      )
                    } else if (imgUrl) {
                      return (
                        <div className="relative w-full h-full flex items-center justify-center">
                          <img src={imgUrl} alt="Cảnh" className="w-full h-full object-contain" />
                          
                          {/* Premium persistent control bar overlay instead of invisible hover overlay */}
                          <div 
                            style={{
                              position: 'absolute',
                              bottom: '16px',
                              left: '50%',
                              transform: 'translateX(-50%)',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '12px',
                              padding: '8px 16px',
                              borderRadius: '12px',
                              border: '1px solid var(--border)',
                              background: 'rgba(17, 17, 40, 0.85)',
                              backdropFilter: 'blur(12px)',
                              boxShadow: '0 8px 32px rgba(0,0,0,0.45)',
                              zIndex: 10
                            }}
                          >
                            <span className="text-[10px] font-bold tracking-wide uppercase" style={{ color: 'var(--text-secondary)' }}>
                              Ảnh sẵn sàng
                            </span>
                            <div className="w-[1px] h-3" style={{ background: 'var(--border)' }} />
                            {vidStatus === 'PROCESSING' ? (
                              <div className="flex items-center gap-1 text-[10px] text-yellow font-bold">
                                <Loader2 size={10} className="spin" />
                                <span>Đang tạo video...</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => triggerManualGeneration('video')}
                                disabled={actionLoading !== null}
                                className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider px-3.5 py-1.5 rounded-lg btn btn-primary active:scale-95 transition-all shadow-md shadow-accent/10"
                              >
                                {actionLoading === 'video' ? <Loader2 size={10} className="spin" /> : <Play size={10} fill="#fff" />}
                                Tạo Video Cảnh
                              </button>
                            )}
                          </div>

                          <div 
                            className="absolute top-3 left-3 backdrop-blur px-2 py-0.5 rounded text-[9px] text-yellow font-bold flex items-center gap-1 border"
                            style={{ background: 'rgba(0,0,0,0.7)', borderColor: 'rgba(245,158,11,0.25)' }}
                          >
                            <Sparkles size={9} className="spin" />
                            Đang chờ tạo video
                          </div>
                        </div>
                      )
                    } else {
                      return (
                        <div className="flex flex-col items-center gap-5 justify-center text-center p-6 max-w-sm">
                          <div 
                            className="w-12 h-12 rounded-xl flex items-center justify-center text-muted"
                            style={{ 
                              background: 'var(--surface)', 
                              border: '1px solid var(--border)',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
                            }}
                          >
                            <Film size={20} className="text-accent/60" />
                          </div>
                          <div>
                            <h4 className="text-xs font-bold" style={{ color: 'var(--text)' }}>Phân cảnh chưa sản xuất</h4>
                            <p className="text-[10px] mt-1" style={{ color: 'var(--muted)', lineHeight: 1.4 }}>
                              Hãy sản xuất thủ công ảnh và video cho phân cảnh kịch bản này.
                            </p>
                          </div>
                          
                          <div className="flex items-center gap-3 mt-1">
                            {/* Manual Image generation button */}
                            {imgStatus === 'PROCESSING' ? (
                              <div className="flex items-center gap-1.5 text-xs text-yellow bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.2)] py-1.5 px-3 rounded-lg shadow-inner">
                                <Loader2 size={10} className="spin" />
                                <span>Đang tạo ảnh...</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => triggerManualGeneration('image')}
                                disabled={actionLoading !== null}
                                className="btn btn-primary text-[10px] font-extrabold uppercase tracking-wider px-3.5 py-2 flex items-center gap-1 shadow-md hover:shadow-accent/15 active:scale-95 transition-all rounded-lg"
                              >
                                <Sparkle size={10} />
                                Tạo Ảnh Cảnh
                              </button>
                            )}

                            {/* Manual Video generation button (disabled if no image) */}
                            {vidStatus === 'PROCESSING' ? (
                              <div className="flex items-center gap-1.5 text-xs text-yellow bg-[rgba(245,158,11,0.06)] border border-[rgba(245,158,11,0.2)] py-1.5 px-3 rounded-lg shadow-inner">
                                <Loader2 size={10} className="spin" />
                                <span>Đang tạo video...</span>
                              </div>
                            ) : (
                              <button
                                onClick={() => triggerManualGeneration('video')}
                                disabled={actionLoading !== null || imgStatus !== 'COMPLETED'}
                                className="btn btn-secondary text-[10px] font-extrabold uppercase tracking-wider px-3.5 py-2 flex items-center gap-1 active:scale-95 transition-all rounded-lg"
                                style={{
                                  border: '1px solid var(--border)',
                                  opacity: imgStatus === 'COMPLETED' ? 1 : 0.45,
                                  cursor: imgStatus === 'COMPLETED' ? 'pointer' : 'not-allowed',
                                }}
                                title={imgStatus !== 'COMPLETED' ? "Vui lòng tạo ảnh trước" : "Tạo video phân cảnh"}
                              >
                                <Play size={10} />
                                Tạo Video
                              </button>
                            )}
                          </div>
                          
                          {imgStatus !== 'COMPLETED' && imgStatus !== 'PROCESSING' && (
                            <span className="text-[9px]" style={{ color: 'var(--muted)' }}>
                              * Cần tạo ảnh cảnh để làm tham chiếu trước khi tạo video
                            </span>
                          )}
                        </div>
                      )
                    }
                  })()}
                </div>
              </div>

              {/* ── Unified Pipeline Status & Action Bar ── */}
              <div
                className="flex items-center justify-between px-3.5 py-2.5 rounded-xl text-xs"
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                }}
              >
                <div className="flex items-center gap-3">
                  <span className="font-extrabold uppercase tracking-wider text-[10px]" style={{ color: 'var(--muted)' }}>Tiến độ:</span>
                  <div className="flex items-center gap-2">
                    {/* Image Status badge */}
                    <span 
                      className="px-2 py-0.5 rounded font-semibold text-[10px] flex items-center gap-1"
                      style={{
                        background: imgStatus === 'COMPLETED' ? 'rgba(34,197,94,0.08)' : imgStatus === 'PROCESSING' ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.01)',
                        color: imgStatus === 'COMPLETED' ? 'var(--green)' : imgStatus === 'PROCESSING' ? 'var(--yellow)' : 'var(--muted)',
                        border: `1px solid ${imgStatus === 'COMPLETED' ? 'rgba(34,197,94,0.2)' : imgStatus === 'PROCESSING' ? 'rgba(245,158,11,0.2)' : 'var(--border)'}`
                      }}
                    >
                      {imgStatus === 'PROCESSING' && <Loader2 size={8} className="spin" />}
                      {imgStatus === 'COMPLETED' ? '✓' : imgStatus === 'FAILED' ? '✗' : '•'} Ảnh
                    </span>

                    {/* Video Status badge */}
                    <span 
                      className="px-2 py-0.5 rounded font-semibold text-[10px] flex items-center gap-1"
                      style={{
                        background: vidStatus === 'COMPLETED' ? 'rgba(34,197,94,0.08)' : vidStatus === 'PROCESSING' ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.01)',
                        color: vidStatus === 'COMPLETED' ? 'var(--green)' : vidStatus === 'PROCESSING' ? 'var(--yellow)' : 'var(--muted)',
                        border: `1px solid ${vidStatus === 'COMPLETED' ? 'rgba(34,197,94,0.2)' : vidStatus === 'PROCESSING' ? 'rgba(245,158,11,0.2)' : 'var(--border)'}`
                      }}
                    >
                      {vidStatus === 'PROCESSING' && <Loader2 size={8} className="spin" />}
                      {vidStatus === 'COMPLETED' ? '✓' : vidStatus === 'FAILED' ? '✗' : '•'} Video
                    </span>

                    {/* Upscale Status badge */}
                    <span 
                      className="px-2 py-0.5 rounded font-semibold text-[10px] flex items-center gap-1"
                      style={{
                        background: upsStatus === 'COMPLETED' ? 'rgba(34,197,94,0.08)' : upsStatus === 'PROCESSING' ? 'rgba(245,158,11,0.08)' : 'rgba(255,255,255,0.01)',
                        color: upsStatus === 'COMPLETED' ? 'var(--green)' : upsStatus === 'PROCESSING' ? 'var(--yellow)' : 'var(--muted)',
                        border: `1px solid ${upsStatus === 'COMPLETED' ? 'rgba(34,197,94,0.2)' : upsStatus === 'PROCESSING' ? 'rgba(245,158,11,0.2)' : 'var(--border)'}`
                      }}
                    >
                      {upsStatus === 'PROCESSING' && <Loader2 size={8} className="spin" />}
                      {upsStatus === 'COMPLETED' ? '✓' : upsStatus === 'FAILED' ? '✗' : '•'} 4K
                    </span>
                  </div>
                </div>

                {/* Quick Trigger Button */}
                <div>
                  {actionLoading !== null ? (
                    <button 
                      disabled 
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg text-yellow bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.2)]"
                    >
                      <Loader2 size={10} className="spin" />
                      Đang xử lý
                    </button>
                  ) : imgStatus === 'PROCESSING' || vidStatus === 'PROCESSING' || upsStatus === 'PROCESSING' ? (
                    <button 
                      disabled 
                      className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-lg text-yellow bg-[rgba(245,158,11,0.08)] border border-[rgba(245,158,11,0.2)] animate-pulse"
                    >
                      <Loader2 size={10} className="spin" />
                      Đang tạo...
                    </button>
                  ) : imgStatus === 'PENDING' || imgStatus === 'FAILED' ? (
                    <button
                      onClick={() => triggerManualGeneration('image')}
                      className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider px-3.5 py-1.5 rounded-lg btn btn-primary shadow-sm active:scale-95"
                    >
                      <Sparkles size={10} />
                      Tạo Ảnh
                    </button>
                  ) : vidStatus === 'PENDING' || vidStatus === 'FAILED' ? (
                    <button
                      onClick={() => triggerManualGeneration('video')}
                      className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider px-3.5 py-1.5 rounded-lg btn btn-primary shadow-sm active:scale-95"
                    >
                      <Play size={10} fill="#fff" />
                      Tạo Video
                    </button>
                  ) : upsStatus === 'PENDING' || upsStatus === 'FAILED' ? (
                    <button
                      onClick={() => triggerManualGeneration('upscale')}
                      className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider px-3.5 py-1.5 rounded-lg bg-[rgba(34,197,94,0.12)] border border-[rgba(34,197,94,0.25)] hover:bg-[rgba(34,197,94,0.2)] text-green active:scale-95 transition-all"
                    >
                      <Sparkle size={10} className="spin" />
                      Upscale 4K
                    </button>
                  ) : (
                    <span className="text-[10px] text-green font-bold flex items-center gap-1 px-2.5 py-1 rounded bg-[rgba(34,197,94,0.08)] border border-[rgba(34,197,94,0.2)]">
                      ✓ Hoàn tất
                    </span>
                  )}
                </div>
              </div>

              {/* ── 2. Bottom Section: Prompts and Scripts ── */}
              <div className="grid gap-3.5 mt-1">
                
                {/* Narrator script card */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                      <Volume2 size={12} className="text-accent" />
                      Lời dẫn truyện & Kịch bản thoại
                    </h4>
                    {selectedScene.narrator_text && (
                      <button
                        onClick={() => handleCopy(selectedScene.narrator_text || '', 'narrator')}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted hover:text-accent transition-colors"
                      >
                        {copiedId === 'narrator' ? <Check size={10} className="text-green" /> : <Copy size={10} />}
                        {copiedId === 'narrator' ? 'Đã sao chép' : 'Sao chép'}
                      </button>
                    )}
                  </div>
                  
                  <div
                    className="p-3.5 rounded-xl font-serif relative animate-fade-in"
                    style={{
                      border: '1px solid var(--border)',
                      background: 'var(--surface)',
                    }}
                  >
                    {selectedScene.narrator_text ? (
                      <p className="text-xs leading-relaxed italic font-medium" style={{ color: 'var(--text)' }}>
                        "{selectedScene.narrator_text}"
                      </p>
                    ) : (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                        Chưa có kịch bản lời dẫn cho phân cảnh này.
                      </p>
                    )}
                  </div>
                </div>

                {/* AI Visual Prompt card */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                      <Sparkles size={12} className="text-accent" />
                      Ý tưởng hình ảnh (AI Prompt)
                    </h4>
                    {selectedScene.prompt && (
                      <button
                        onClick={() => handleCopy(selectedScene.prompt || '', 'prompt')}
                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted hover:text-accent transition-colors"
                      >
                        {copiedId === 'prompt' ? <Check size={10} className="text-green" /> : <Copy size={10} />}
                        {copiedId === 'prompt' ? 'Đã sao chép' : 'Sao chép'}
                      </button>
                    )}
                  </div>

                  <div
                    className="p-3.5 rounded-xl font-mono relative animate-fade-in"
                    style={{
                      border: '1px solid var(--border)',
                      background: 'var(--surface)'
                    }}
                  >
                    {selectedScene.prompt ? (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                        {selectedScene.prompt}
                      </p>
                    ) : (
                      <p className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
                        Chưa thiết lập mô tả bối cảnh hình ảnh cho phân cảnh này.
                      </p>
                    )}
                  </div>
                </div>

              </div>

            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 gap-3">
              <Film size={36} className="text-muted opacity-40 animate-pulse" />
              <div className="text-xs font-bold text-muted">Vui lòng chọn một phân cảnh bên trái</div>
              <div className="text-[10px] text-muted/60 max-w-xs leading-relaxed">
                Danh sách bên trái chứa toàn bộ chuỗi phân cảnh kịch bản của tập phim này. Nhấp vào bất kỳ cảnh nào để xem.
              </div>
            </div>
          )}
        </div>

      </div>

      {/* Floating Toast Notification */}
      {toast && (
        <div 
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-xl border shadow-2xl animate-fade-in"
          style={{
            background: toast.type === 'success' ? 'rgba(34, 197, 94, 0.95)' : toast.type === 'error' ? 'rgba(239, 68, 68, 0.95)' : 'rgba(79, 142, 247, 0.95)',
            borderColor: toast.type === 'success' ? 'rgba(34, 197, 94, 0.2)' : toast.type === 'error' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(79, 142, 247, 0.2)',
            color: '#fff',
            backdropFilter: 'blur(10px)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)'
          }}
        >
          {toast.type === 'success' && <Check size={14} strokeWidth={3} />}
          {toast.type === 'error' && <ArrowLeft size={14} className="rotate-180" strokeWidth={3} />}
          <span className="text-xs font-bold">{toast.message}</span>
        </div>
      )}

    </div>
  )
}
