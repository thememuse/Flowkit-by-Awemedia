import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Clapperboard, Play, X, ChevronLeft, Save,
  RefreshCw, XCircle, Download, Loader2, ScanEye, FolderOpen, Zap, RotateCcw,
  Sparkles, Plus, Trash2, Layers, CheckCircle2, AlertCircle, Clock, Film, FileUp
} from 'lucide-react'
import { fetchAPI, postAPI, patchAPI, deleteAPI } from '../api/client'
import { useWebSocket } from '../api/useWebSocket'
import { useDownload, buildFilename } from '../api/useDownload'
import type { Project, Video, Scene, StatusType } from '../types'

interface BatchStatus {
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  done: boolean
  all_succeeded: boolean
}

interface VideoError {
  severity: string
  time_range: string
  description: string
}

interface DimensionScores {
  character_consistency: number
  prompt_adherence: number
  motion_quality: number
  visual_fidelity: number
  temporal_coherence: number
  composition: number
}

interface SceneReview {
  scene_id: string
  overall_score: number
  verdict: string
  dimensions: DimensionScores
  errors: VideoError[]
  fix_guide: string
  frames_analyzed: number
  has_critical_errors?: boolean
}

interface VideoReview {
  video_id: string
  project_id: string
  overall_score: number
  verdict: string
  scene_reviews: SceneReview[]
  scenes_reviewed: number
  scenes_skipped: number
}

// Pipeline stage for sandbox batch
type PipelineStage = 'idle' | 'creating_images' | 'waiting_images' | 'creating_videos' | 'waiting_videos' | 'done'

export default function BatchVideoPage() {
  const { id: projectId, vid: videoId } = useParams<{ id: string; vid: string }>()
  const navigate = useNavigate()
  const { saveFile, saveBatch } = useDownload()
  const { lastEvent } = useWebSocket()

  // Resolved sandbox IDs
  const [sandboxProjId, setSandboxProjId] = useState<string | null>(null)
  const [sandboxVidId, setSandboxVidId] = useState<string | null>(null)

  // Data States
  const [project, setProject] = useState<Project | null>(null)
  const [video, setVideo] = useState<Video | null>(null)
  const [videos, setVideos] = useState<Video[]>([])
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(true)

  // Prompt edit states (project mode)
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({})
  const [savingPrompts, setSavingPrompts] = useState<Record<string, boolean>>({})

  // Vision Review State
  const [reviewRunning, setReviewRunning] = useState(false)
  const [videoReview, setVideoReview] = useState<VideoReview | null>(null)
  const [showReviewDetails, setShowReviewDetails] = useState<Record<string, boolean>>({})

  // Video Preview Modal
  const [previewVideoUrl, setPreviewVideoUrl] = useState<string | null>(null)

  // Batch Job Polling
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null)
  const [batchType, setBatchType] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sandbox batch input
  const [batchPrompts, setBatchPrompts] = useState<string[]>([''])
  const [triggering, setTriggering] = useState(false)
  const [pipelineStage, setPipelineStage] = useState<PipelineStage>('idle')
  const [sandboxOrientation, setSandboxOrientation] = useState<'VERTICAL' | 'HORIZONTAL'>('VERTICAL')

  // File import ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Parse TXT / CSV file into prompt list
  function parseImportFile(text: string, filename: string): string[] {
    const ext = filename.split('.').pop()?.toLowerCase()
    if (ext === 'csv') {
      return text
        .split('\n')
        .map(line => {
          const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
          return cols.length >= 2 ? cols[1] : cols[0]
        })
        .filter(p => p && p.toLowerCase() !== 'prompt' && p.toLowerCase() !== 'description')
    }
    return text.split('\n').map(l => l.trim()).filter(Boolean)
  }

  function handleFileImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      const prompts = parseImportFile(text, file.name)
      if (prompts.length > 0) {
        setBatchPrompts(prev => {
          const existing = prev.filter(p => p.trim())
          return [...existing, ...prompts]
        })
      }
    }
    reader.readAsText(file, 'utf-8')
    e.target.value = ''
  }

  const isSandbox = !projectId || !videoId || projectId === 'sandbox' || videoId === 'sandbox'
  const orientation = isSandbox ? sandboxOrientation : (video?.orientation ?? 'VERTICAL')
  const ori = orientation.toLowerCase()

  // ── Resolve sandbox project/video IDs ──────────────────────────────────────
  const resolveSandbox = useCallback(async () => {
    if (!isSandbox) return null
    const projects = await fetchAPI<Project[]>('/api/projects')
    let proj = projects.find(p => p.name === '__quick_sandbox_studio__' && p.status !== 'DELETED')

    if (!proj) {
      proj = await postAPI<Project>('/api/projects', {
        name: '__quick_sandbox_studio__',
        description: 'Quick Sandbox Playground for project-independent generations.',
        story: 'Sandbox Playground',
        material: 'realistic',
        language: 'vi'
      })
      await postAPI(`/api/projects/${proj.id}/sync-flow`, {}).catch(() => {})
    }

    const vids = await fetchAPI<Video[]>(`/api/videos?project_id=${proj.id}`)
    let vid = vids[0]

    if (!vid) {
      vid = await postAPI<Video>('/api/videos', {
        project_id: proj.id,
        title: 'Batch Video',
        description: 'Sandbox Batch Video',
        orientation: sandboxOrientation,
        display_order: 0
      })
    }

    setSandboxProjId(proj.id)
    setSandboxVidId(vid.id)
    return { projId: proj.id, vidId: vid.id }
  }, [isSandbox, sandboxOrientation])

  // ── Load data ────────────────────────────────────────────────────────────
  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      let targetProjId = projectId
      let targetVidId = videoId

      if (isSandbox) {
        let rProjId = sandboxProjId
        let rVidId = sandboxVidId
        if (!rProjId || !rVidId) {
          const resolved = await resolveSandbox()
          if (!resolved) return
          rProjId = resolved.projId
          rVidId = resolved.vidId
        }
        targetProjId = rProjId
        targetVidId = rVidId
      }

      if (!targetProjId || !targetVidId) return

      const [proj, v, vids, scs] = await Promise.all([
        fetchAPI<Project>(`/api/projects/${targetProjId}`),
        fetchAPI<Video>(`/api/videos/${targetVidId}`),
        fetchAPI<Video[]>(`/api/videos?project_id=${targetProjId}`),
        fetchAPI<Scene[]>(`/api/scenes?video_id=${targetVidId}`)
      ])
      setProject(proj)
      setVideo(v)
      setVideos(vids)

      if (isSandbox) {
        setScenes(scs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
      } else {
        setScenes(scs.sort((a, b) => a.display_order - b.display_order))
      }

      if (!isSandbox) {
        const promptDict: Record<string, string> = {}
        scs.forEach(s => {
          promptDict[s.id] = s.video_prompt ?? ''
        })
        setEditedPrompts(prev => ({ ...promptDict, ...prev }))
      }
    } catch (err) {
      console.error('Failed to load Batch Video data:', err)
    } finally {
      if (!silent) setLoading(false)
    }
  }, [projectId, videoId, isSandbox, sandboxProjId, sandboxVidId, resolveSandbox])

  useEffect(() => {
    loadData()
  }, [loadData])

  // WebSocket Live Sync
  useEffect(() => {
    if (!lastEvent) return
    const t = lastEvent.type
    if (['scene_updated', 'request_completed', 'request_failed', 'urls_refreshed'].includes(t)) {
      loadData(true)
    }
  }, [lastEvent, loadData])

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  // ── Status polling helper ──────────────────────────────────────────────────
  const startStatusPolling = (type: string, queryParam: string, since: string, onDone?: () => void) => {
    if (pollRef.current) clearInterval(pollRef.current)
    setBatchRunning(true)
    setBatchType(type)

    const poll = async () => {
      try {
        const s = await fetchAPI<BatchStatus>(
          `/api/requests/batch-status?${queryParam}&type=${type}&since=${encodeURIComponent(since)}`
        )
        setBatchStatus(s)
        if (s.done) {
          if (pollRef.current) clearInterval(pollRef.current)
          setBatchRunning(false)
          setBatchType(null)
          setBatchStatus(null)
          loadData(true)
          onDone?.()
        }
      } catch (_) {
        if (pollRef.current) clearInterval(pollRef.current)
        setBatchRunning(false)
      }
    }
    poll()
    pollRef.current = setInterval(poll, 3000)
  }

  const stopPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current)
    setBatchRunning(false)
    setBatchType(null)
    setBatchStatus(null)
  }

  // ── Sandbox Batch Submit — Auto Pipeline ─────────────────────────────────
  async function handleBatchSubmit() {
    const validPrompts = batchPrompts.filter(p => p.trim())
    if (validPrompts.length === 0) return
    setTriggering(true)
    setPipelineStage('creating_images')
    try {
      let rProjId = sandboxProjId
      let rVidId = sandboxVidId
      if (!rProjId || !rVidId) {
        const resolved = await resolveSandbox()
        if (!resolved) return
        rProjId = resolved.projId
        rVidId = resolved.vidId
      }

      const since = new Date().toISOString()

      // Step 1: Create all scenes in parallel
      const createdScenes = await Promise.all(
        validPrompts.map((prompt, idx) =>
          postAPI<Scene>('/api/scenes', {
            video_id: rVidId,
            display_order: scenes.length + idx,
            chain_type: 'ROOT',
            prompt: prompt.trim(),
            image_prompt: prompt.trim(),
            video_prompt: prompt.trim()
          })
        )
      )

      // Step 2: Submit batch image generation for all scenes
      setPipelineStage('waiting_images')
      await postAPI('/api/requests/batch', {
        requests: createdScenes.map(scene => ({
          type: 'GENERATE_IMAGE',
          scene_id: scene.id,
          project_id: rProjId,
          video_id: rVidId,
          orientation: orientation
        }))
      })

      setBatchPrompts([''])
      setTriggering(false)

      // Step 3: Poll until images done, then auto-submit videos
      const videoSince = new Date().toISOString()
      startStatusPolling('GENERATE_IMAGE', `video_id=${rVidId}`, since, async () => {
        // After images done → auto-submit video animation
        setPipelineStage('creating_videos')
        const updatedScenes = await fetchAPI<Scene[]>(`/api/scenes?video_id=${rVidId}`)
        const readyForVideo = updatedScenes.filter(s => {
          const imgStatus = s[`${ori}_image_status` as keyof Scene] as StatusType
          const vidStatus = s[`${ori}_video_status` as keyof Scene] as StatusType
          return imgStatus === 'COMPLETED' && vidStatus !== 'COMPLETED' && vidStatus !== 'PROCESSING'
        })

        if (readyForVideo.length > 0) {
          setPipelineStage('waiting_videos')
          await postAPI('/api/requests/batch', {
            requests: readyForVideo.map(s => ({
              type: 'GENERATE_VIDEO',
              scene_id: s.id,
              project_id: rProjId,
              video_id: rVidId,
              orientation: orientation
            }))
          })
          startStatusPolling('GENERATE_VIDEO', `video_id=${rVidId}`, videoSince, () => {
            setPipelineStage('done')
            setTimeout(() => setPipelineStage('idle'), 3000)
          })
        } else {
          setPipelineStage('idle')
        }
      })
    } catch (e) {
      console.error('Failed to submit batch videos:', e)
      setTriggering(false)
      setPipelineStage('idle')
    }
  }

  // ── Project mode actions ──────────────────────────────────────────────────

  async function savePrompt(sceneId: string, immediateGen = false) {
    const text = editedPrompts[sceneId] ?? ''
    setSavingPrompts(prev => ({ ...prev, [sceneId]: true }))
    try {
      await patchAPI(`/api/scenes/${sceneId}`, {
        video_prompt: text.trim() || null
      })
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, video_prompt: text.trim() } : s))
      if (immediateGen) await triggerSingleVideoGen(sceneId, true)
    } catch (e) {
      console.error('Failed to save video prompt:', e)
    } finally {
      setSavingPrompts(prev => ({ ...prev, [sceneId]: false }))
    }
  }

  async function triggerSingleVideoGen(sceneId: string, regen = false) {
    const pId = isSandbox ? sandboxProjId : projectId
    const vId = isSandbox ? sandboxVidId : videoId
    if (!pId || !vId) return
    try {
      await postAPI('/api/requests/batch', {
        requests: [{
          type: regen ? 'REGENERATE_VIDEO' : 'GENERATE_VIDEO',
          scene_id: sceneId,
          project_id: pId,
          video_id: vId,
          orientation: orientation.toUpperCase(),
        }]
      })
      loadData(true)
    } catch (e) {
      console.error('Failed to generate single video:', e)
    }
  }

  async function triggerSingleUpscale(sceneId: string) {
    const pId = isSandbox ? sandboxProjId : projectId
    const vId = isSandbox ? sandboxVidId : videoId
    if (!pId || !vId) return
    try {
      await postAPI('/api/requests/batch', {
        requests: [{
          type: 'UPSCALE_VIDEO',
          scene_id: sceneId,
          project_id: pId,
          video_id: vId,
          orientation: orientation.toUpperCase(),
        }]
      })
      loadData(true)
    } catch (e) {
      console.error('Failed to upscale video:', e)
    }
  }

  async function generateAllVideos() {
    const pId = isSandbox ? sandboxProjId : projectId
    const vId = isSandbox ? sandboxVidId : videoId
    if (!pId || !vId || scenes.length === 0) return
    const need = scenes.filter(s => {
      const imgStatus = s[`${ori}_image_status` as keyof Scene] as StatusType ?? 'PENDING'
      const vidStatus = s[`${ori}_video_status` as keyof Scene] as StatusType ?? 'PENDING'
      return imgStatus === 'COMPLETED' && vidStatus !== 'COMPLETED' && vidStatus !== 'PROCESSING'
    })
    if (need.length === 0) return

    setBatchRunning(true)
    try {
      const since = new Date().toISOString()
      await postAPI('/api/requests/batch', {
        requests: need.map(s => ({
          type: 'GENERATE_VIDEO',
          scene_id: s.id,
          project_id: pId,
          video_id: vId,
          orientation: orientation.toUpperCase(),
        }))
      })
      startStatusPolling('GENERATE_VIDEO', `video_id=${vId}`, since)
    } catch (e) {
      console.error('Failed to submit batch video requests:', e)
      setBatchRunning(false)
    }
  }

  async function upscaleAllVideos() {
    const pId = isSandbox ? sandboxProjId : projectId
    const vId = isSandbox ? sandboxVidId : videoId
    if (!pId || !vId || scenes.length === 0) return
    const need = scenes.filter(s => {
      const vidStatus = s[`${ori}_video_status` as keyof Scene] as StatusType ?? 'PENDING'
      const upsStatus = s[`${ori}_upscale_status` as keyof Scene] as StatusType ?? 'PENDING'
      return vidStatus === 'COMPLETED' && upsStatus !== 'COMPLETED' && upsStatus !== 'PROCESSING'
    })
    if (need.length === 0) return

    setBatchRunning(true)
    try {
      const since = new Date().toISOString()
      await postAPI('/api/requests/batch', {
        requests: need.map(s => ({
          type: 'UPSCALE_VIDEO',
          scene_id: s.id,
          project_id: pId,
          video_id: vId,
          orientation: orientation.toUpperCase(),
        }))
      })
      startStatusPolling('UPSCALE_VIDEO', `video_id=${vId}`, since)
    } catch (e) {
      console.error('Failed to submit batch upscale requests:', e)
      setBatchRunning(false)
    }
  }

  async function runAIVisionReview() {
    const pId = isSandbox ? sandboxProjId : projectId
    const vId = isSandbox ? sandboxVidId : videoId
    if (!pId || !vId) return
    setReviewRunning(true)
    try {
      const res = await postAPI<VideoReview>(`/api/videos/${vId}/review?mode=light`, {
        project_id: pId
      })
      setVideoReview(res)
    } catch (e) {
      console.error('Failed to perform AI Vision Review:', e)
    } finally {
      setReviewRunning(false)
    }
  }

  async function cancelActiveRequest(sceneId: string, type: 'GENERATE_VIDEO' | 'UPSCALE_VIDEO') {
    try {
      await postAPI(`/api/requests/cancel-active?scene_id=${sceneId}&type=${type}&orientation=${orientation.toUpperCase()}`, {})
      loadData(true)
    } catch (e) {
      console.error('Failed to cancel active video request:', e)
    }
  }

  async function cancelAllActive() {
    const activeScenes = scenes.filter(s => {
      const status = s[`${ori}_video_status` as keyof Scene] as StatusType ?? 'PENDING'
      const upsStatus = s[`${ori}_upscale_status` as keyof Scene] as StatusType ?? 'PENDING'
      return status === 'PROCESSING' || status === 'PENDING' || upsStatus === 'PROCESSING' || upsStatus === 'PENDING'
    })
    stopPolling()
    setPipelineStage('idle')
    for (const s of activeScenes) {
      const status = s[`${ori}_video_status` as keyof Scene] as StatusType
      const upsStatus = s[`${ori}_upscale_status` as keyof Scene] as StatusType
      if (status === 'PROCESSING' || status === 'PENDING') {
        await cancelActiveRequest(s.id, 'GENERATE_VIDEO')
      }
      if (upsStatus === 'PROCESSING' || upsStatus === 'PENDING') {
        await cancelActiveRequest(s.id, 'UPSCALE_VIDEO')
      }
    }
    loadData(true)
  }

  async function deleteSandboxScene(sceneId: string) {
    try {
      await deleteAPI(`/api/scenes/${sceneId}`)
      setScenes(prev => prev.filter(s => s.id !== sceneId))
    } catch (e) {
      console.error('Failed to delete sandbox scene:', e)
    }
  }

  async function downloadSingleVideo(scene: Scene) {
    const url = (scene[`${ori}_upscale_url` as keyof Scene] || scene[`${ori}_video_url` as keyof Scene]) as string | null
    if (!url || !project) return
    try {
      const isUps = !!(scene[`${ori}_upscale_url` as keyof Scene])
      await saveFile({
        url,
        filename: buildFilename(scene.display_order, isUps ? 'upscale' : 'video', 'mp4'),
        projectName: isSandbox ? 'batch-studio' : project.name,
        sceneName: `canh-${scene.display_order + 1}`
      })
    } catch (e) {
      console.error('Failed to download video:', e)
    }
  }

  async function downloadAllDoneVideos() {
    const pName = isSandbox ? 'batch-studio' : (project?.name ?? 'project')
    const items = scenes
      .map(s => {
        const url = (s[`${ori}_upscale_url` as keyof Scene] || s[`${ori}_video_url` as keyof Scene]) as string | null
        const isUps = !!(s[`${ori}_upscale_url` as keyof Scene])
        return {
          url,
          filename: buildFilename(s.display_order, isUps ? 'upscale' : 'video', 'mp4'),
          projectName: pName
        }
      })
      .filter(x => !!x.url) as { url: string; filename: string; projectName: string }[]

    if (items.length > 0) {
      await saveBatch({ items, projectName: pName })
    }
  }

  async function openOutputDir() {
    const pId = isSandbox ? sandboxProjId : projectId
    if (!pId) return
    try {
      const electronAPI = (window as unknown as { electronAPI?: { revealFile?: (p: string) => void } }).electronAPI
      if (electronAPI?.revealFile) {
        const outDir = await fetchAPI<{ path: string }>(`/api/projects/${pId}/output-dir`)
        electronAPI.revealFile(outDir.path)
        return
      }
      await postAPI(`/api/projects/${pId}/open-folder`, {})
    } catch (err) {
      console.error('Failed to open output directory:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 size={32} className="spin" style={{ color: 'var(--accent)' }} />
        <span className="text-sm" style={{ color: 'var(--muted)' }}>Đang tải Batch Video Studio...</span>
      </div>
    )
  }

  // Stats calculation
  const totalScenes = scenes.length
  const compVideos = scenes.filter(s => (s[`${ori}_video_status` as keyof Scene] as StatusType) === 'COMPLETED').length
  const procVideos = scenes.filter(s => (s[`${ori}_video_status` as keyof Scene] as StatusType) === 'PROCESSING').length
  const pendVideos = scenes.filter(s => (s[`${ori}_video_status` as keyof Scene] as StatusType) === 'PENDING').length
  const failVideos = scenes.filter(s => (s[`${ori}_video_status` as keyof Scene] as StatusType) === 'FAILED').length
  const progressVideoPct = totalScenes > 0 ? Math.round((compVideos / totalScenes) * 100) : 0

  const compImages = scenes.filter(s => (s[`${ori}_image_status` as keyof Scene] as StatusType) === 'COMPLETED').length
  const progressImagePct = totalScenes > 0 ? Math.round((compImages / totalScenes) * 100) : 0

  const compUpscales = scenes.filter(s => (s[`${ori}_upscale_status` as keyof Scene] as StatusType) === 'COMPLETED').length
  const procUpscales = scenes.filter(s => (s[`${ori}_upscale_status` as keyof Scene] as StatusType) === 'PROCESSING').length
  const failUpscales = scenes.filter(s => (s[`${ori}_upscale_status` as keyof Scene] as StatusType) === 'FAILED').length
  const progressUpscalePct = compVideos > 0 ? Math.round((compUpscales / compVideos) * 100) : 0

  const readyToAnimate = scenes.filter(s => (s[`${ori}_image_status` as keyof Scene] as StatusType) === 'COMPLETED' && (s[`${ori}_video_status` as keyof Scene] as StatusType) !== 'COMPLETED').length

  const validBatchPrompts = batchPrompts.filter(p => p.trim()).length

  // Pipeline stage label
  const pipelineLabel: Record<PipelineStage, string> = {
    idle: '',
    creating_images: 'Đang tạo scenes...',
    waiting_images: `Đang tạo ảnh... (${compImages}/${totalScenes} xong)`,
    creating_videos: 'Ảnh xong, đang chuyển sang video...',
    waiting_videos: `Đang tạo video... (${compVideos}/${totalScenes} xong)`,
    done: 'Hoàn thành pipeline!'
  }

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Video Preview Modal */}
      {previewVideoUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.94)' }}>
          <div className="relative flex flex-col items-center gap-2" style={{ maxWidth: 440, width: '92%' }}>
            <button
              onClick={() => setPreviewVideoUrl(null)}
              className="absolute -top-10 right-0 flex items-center gap-1 text-xs px-2.5 py-1 rounded bg-[rgba(255,255,255,0.1)] text-white"
            >
              <X size={14} /> Đóng
            </button>
            <video src={previewVideoUrl} controls autoPlay playsInline className="rounded-xl w-full max-h-[80vh] shadow-2xl" style={{ background: '#000' }} />
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {!isSandbox ? (
            <button
              onClick={() => navigate(`/studio/${projectId}`)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border hover:bg-[rgba(255,255,255,0.03)]"
              style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <ChevronLeft size={13} /> Quay lại Studio
            </button>
          ) : (
            <button
              onClick={() => navigate(`/`)}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border hover:bg-[rgba(255,255,255,0.03)]"
              style={{ background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <ChevronLeft size={13} /> Tổng quan
            </button>
          )}
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>/</span>
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>Batch Video</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mt-1">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <Clapperboard size={22} style={{ color: 'var(--yellow)' }} />
              {isSandbox ? 'Batch Tạo Video Nhanh' : 'Batch Video & Hoạt Ảnh Hàng Loạt'}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {isSandbox ? (
                <span className="flex items-center gap-1">
                  <Zap size={11} /> Pipeline tự động: Ảnh → Video — không cần tạo dự án
                </span>
              ) : (
                <span>Dự án: <span className="font-semibold" style={{ color: 'var(--text)' }}>{project?.name}</span> • Tập: <span className="font-semibold" style={{ color: 'var(--text)' }}>{video?.title}</span> ({orientation})</span>
              )}
            </p>
          </div>

          {!isSandbox && videos.length > 1 && (
            <div className="flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--muted)' }}>Chọn tập khác:</span>
              <select
                value={videoId}
                onChange={e => navigate(`/batch-videos/${projectId}/${e.target.value}`)}
                className="px-2 py-1.5 rounded outline-none cursor-pointer border"
                style={{ background: 'var(--card)', color: 'var(--text)', borderColor: 'var(--border)' }}
              >
                {videos.map(v => (
                  <option key={v.id} value={v.id}>{v.title}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {/* ── Sandbox Batch Input Panel ─────────────────────────────────────── */}
      {isSandbox && (
        <div
          className="rounded-xl p-4 flex flex-col gap-4"
          style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
        >
          {/* Title row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Layers size={15} style={{ color: 'var(--yellow)' }} />
              <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                Nhập danh sách ý tưởng video
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--yellow)' }}>
                {validBatchPrompts} video sẽ tạo
              </span>
            </div>

            {/* Orientation selector */}
            <div className="flex items-center gap-2 text-xs">
              <span style={{ color: 'var(--muted)' }}>Khung hình:</span>
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                <button
                  onClick={() => setSandboxOrientation('VERTICAL')}
                  className="px-3 py-1.5 font-semibold transition-all"
                  style={{
                    background: sandboxOrientation === 'VERTICAL' ? 'var(--yellow)' : 'var(--surface)',
                    color: sandboxOrientation === 'VERTICAL' ? '#000' : 'var(--muted)'
                  }}
                >
                  Dọc 9:16
                </button>
                <button
                  onClick={() => setSandboxOrientation('HORIZONTAL')}
                  className="px-3 py-1.5 font-semibold transition-all"
                  style={{
                    background: sandboxOrientation === 'HORIZONTAL' ? 'var(--yellow)' : 'var(--surface)',
                    color: sandboxOrientation === 'HORIZONTAL' ? '#000' : 'var(--muted)'
                  }}
                >
                  Ngang 16:9
                </button>
              </div>
            </div>
          </div>

          {/* Prompt list */}
          <div className="flex flex-col gap-2">
            {batchPrompts.map((prompt, idx) => (
              <div key={idx} className="flex gap-2 items-start">
                <span
                  className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold mt-1"
                  style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--yellow)' }}
                >
                  {idx + 1}
                </span>
                <textarea
                  rows={2}
                  value={prompt}
                  onChange={e => {
                    const next = [...batchPrompts]
                    next[idx] = e.target.value
                    setBatchPrompts(next)
                  }}
                  placeholder={`Prompt video #${idx + 1}: Mô tả chuyển động máy quay, hành động nhân vật...`}
                  className="flex-1 text-sm p-2.5 rounded-lg outline-none resize-none border"
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    borderColor: prompt.trim() ? 'rgba(245,158,11,0.3)' : 'var(--border)',
                  }}
                />
                {batchPrompts.length > 1 && (
                  <button
                    onClick={() => setBatchPrompts(prev => prev.filter((_, i) => i !== idx))}
                    className="flex-shrink-0 p-1.5 rounded-lg mt-1 hover:bg-[rgba(239,68,68,0.1)] transition-all"
                    style={{ color: 'var(--muted)' }}
                    title="Xóa prompt này"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>

          {/* Add prompt + Submit row */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setBatchPrompts(prev => [...prev, ''])}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border hover:bg-[rgba(245,158,11,0.06)] transition-all"
                style={{ borderColor: 'rgba(245,158,11,0.25)', color: 'var(--yellow)' }}
              >
                <Plus size={13} /> Thêm video
              </button>

              {/* Import TXT/CSV */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.csv"
                className="hidden"
                onChange={handleFileImport}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border hover:bg-[rgba(245,158,11,0.06)] transition-all"
                style={{ borderColor: 'rgba(245,158,11,0.25)', color: 'var(--yellow)' }}
                title="Import danh sách từ file TXT hoặc CSV (mỗi dòng = 1 prompt)"
              >
                <FileUp size={13} /> Import TXT/CSV
              </button>
            </div>

            <button
              onClick={handleBatchSubmit}
              disabled={triggering || validBatchPrompts === 0 || batchRunning || pipelineStage !== 'idle'}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-black transition-all shadow-lg"
              style={{
                background: validBatchPrompts > 0 ? 'var(--yellow)' : 'var(--surface)',
                opacity: (triggering || validBatchPrompts === 0 || batchRunning) ? 0.5 : 1,
                cursor: (triggering || validBatchPrompts === 0 || batchRunning) ? 'not-allowed' : 'pointer'
              }}
            >
              {triggering ? (
                <><Loader2 size={15} className="spin" style={{ color: '#000' }} /> Đang gửi...</>
              ) : (
                <><Sparkles size={14} /> Tạo {validBatchPrompts} video hàng loạt</>
              )}
            </button>
          </div>

          {/* Pipeline progress */}
          {pipelineStage !== 'idle' && (
            <div className="p-3 rounded-lg flex flex-col gap-2" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}>
              {/* Stage indicators */}
              <div className="flex items-center gap-3 text-xs">
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{
                      background: ['creating_images', 'waiting_images', 'creating_videos', 'waiting_videos', 'done'].includes(pipelineStage) ? 'var(--yellow)' : 'var(--surface)',
                      color: ['creating_images', 'waiting_images', 'creating_videos', 'waiting_videos', 'done'].includes(pipelineStage) ? '#000' : 'var(--muted)'
                    }}
                  >1</span>
                  <span style={{ color: ['creating_images', 'waiting_images'].includes(pipelineStage) ? 'var(--yellow)' : 'var(--muted)' }}>
                    Tạo ảnh
                  </span>
                </div>
                <span style={{ color: 'var(--muted)' }}>→</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{
                      background: ['creating_videos', 'waiting_videos', 'done'].includes(pipelineStage) ? 'var(--yellow)' : 'var(--surface)',
                      color: ['creating_videos', 'waiting_videos', 'done'].includes(pipelineStage) ? '#000' : 'var(--muted)'
                    }}
                  >2</span>
                  <span style={{ color: ['creating_videos', 'waiting_videos'].includes(pipelineStage) ? 'var(--yellow)' : 'var(--muted)' }}>
                    Tạo video
                  </span>
                </div>
                <span style={{ color: 'var(--muted)' }}>→</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0"
                    style={{
                      background: pipelineStage === 'done' ? 'var(--green)' : 'var(--surface)',
                      color: pipelineStage === 'done' ? '#fff' : 'var(--muted)'
                    }}
                  >✓</span>
                  <span style={{ color: pipelineStage === 'done' ? 'var(--green)' : 'var(--muted)' }}>
                    Hoàn thành
                  </span>
                </div>
              </div>

              {/* Status message */}
              <div className="flex items-center justify-between">
                <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--yellow)' }}>
                  {pipelineStage !== 'done' && <Loader2 size={11} className="spin" />}
                  {pipelineStage === 'done' && <CheckCircle2 size={11} style={{ color: 'var(--green)' }} />}
                  <span style={{ color: pipelineStage === 'done' ? 'var(--green)' : 'var(--yellow)' }}>
                    {pipelineLabel[pipelineStage]}
                  </span>
                </span>
                {batchRunning && (
                  <button
                    onClick={cancelAllActive}
                    className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px]"
                    style={{ borderColor: 'rgba(239,68,68,0.4)', color: 'var(--red)', background: 'rgba(239,68,68,0.06)' }}
                  >
                    <XCircle size={10} /> Dừng pipeline
                  </button>
                )}
              </div>

              {/* Batch progress bar */}
              {batchStatus && batchStatus.total > 0 && (
                <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--surface)' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.round((batchStatus.completed / batchStatus.total) * 100)}%`,
                      background: 'var(--yellow)',
                      transition: 'width 0.4s'
                    }}
                  />
                </div>
              )}
            </div>
          )}

          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            Pipeline tự động: Ảnh sẽ được tạo trước, sau đó video sẽ tự khởi động. Tối đa 5 tác vụ song song.
          </p>
        </div>
      )}

      {/* ── Double Progress Tracking & Bulk controls ──────────────────────── */}
      <div
        className="rounded-xl p-4 flex flex-col gap-4"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {/* Progress 1: Images */}
          {isSandbox && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs font-semibold">
                <span className="flex items-center gap-1" style={{ color: 'var(--green)' }}>
                  <CheckCircle2 size={13} /> Ảnh cảnh: {progressImagePct}%
                </span>
                <span style={{ color: 'var(--muted)' }}>{compImages}/{totalScenes}</span>
              </div>
              <div className="rounded-full overflow-hidden" style={{ height: 5, background: 'var(--surface)' }}>
                <div style={{ height: '100%', width: `${progressImagePct}%`, background: 'var(--green)', transition: 'width 0.5s' }} />
              </div>
            </div>
          )}

          {/* Progress 2: Video Animation */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                <Clapperboard size={13} /> Hoạt ảnh (I2V): {progressVideoPct}%
              </span>
              <span style={{ color: 'var(--muted)' }}>{compVideos}/{totalScenes}</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 5, background: 'var(--surface)' }}>
              <div style={{ height: '100%', width: `${progressVideoPct}%`, background: 'var(--accent)', transition: 'width 0.5s' }} />
            </div>
            <div className="flex gap-3 text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>
              <span className="flex items-center gap-1"><CheckCircle2 size={10} style={{ color: 'var(--green)' }} /> {compVideos} xong</span>
              {procVideos > 0 && <span className="flex items-center gap-1"><Loader2 size={10} className="spin" style={{ color: 'var(--yellow)' }} /> {procVideos} render</span>}
              {failVideos > 0 && <span className="flex items-center gap-1"><AlertCircle size={10} style={{ color: 'var(--red)' }} /> {failVideos} lỗi</span>}
            </div>
          </div>

          {/* Progress 3: 4K Upscale */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="flex items-center gap-1" style={{ color: 'var(--yellow)' }}>
                <Zap size={13} /> Nâng cấp 4K: {progressUpscalePct}%
              </span>
              <span style={{ color: 'var(--muted)' }}>{compUpscales}/{compVideos || totalScenes}</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 5, background: 'var(--surface)' }}>
              <div style={{ height: '100%', width: `${progressUpscalePct}%`, background: 'var(--yellow)', transition: 'width 0.5s' }} />
            </div>
            <div className="flex gap-3 text-[10px] mt-0.5" style={{ color: 'var(--muted)' }}>
              <span className="flex items-center gap-1"><CheckCircle2 size={10} style={{ color: 'var(--yellow)' }} /> {compUpscales} 4K</span>
              {procUpscales > 0 && <span className="flex items-center gap-1"><Loader2 size={10} className="spin" /> {procUpscales} đang nâng</span>}
              {failUpscales > 0 && <span className="flex items-center gap-1"><AlertCircle size={10} style={{ color: 'var(--red)' }} /> {failUpscales} lỗi</span>}
            </div>
          </div>
        </div>

        {/* Global Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            {readyToAnimate > 0 ? (
              <span className="flex items-center gap-1" style={{ color: 'var(--yellow)' }}>
                <Clock size={12} /> {readyToAnimate} cảnh sẵn sàng chuyển thành hoạt ảnh
              </span>
            ) : totalScenes > 0 ? (
              <span className="flex items-center gap-1"><CheckCircle2 size={12} style={{ color: 'var(--green)' }} /> Tất cả cảnh đã đồng bộ</span>
            ) : null}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => loadData(false)}
              title="Làm mới"
              className="flex items-center justify-center p-2 rounded-lg border hover:bg-[rgba(255,255,255,0.03)]"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              <RefreshCw size={14} />
            </button>

            {(batchRunning || procVideos > 0 || pendVideos > 0 || procUpscales > 0) && (
              <button
                onClick={cancelAllActive}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all"
                style={{
                  background: 'rgba(239,68,68,0.08)',
                  color: 'var(--red)',
                  borderColor: 'rgba(239,68,68,0.3)',
                }}
              >
                <XCircle size={13} /> Dừng tất cả
              </button>
            )}

            {/* AI Vision Review */}
            <button
              onClick={runAIVisionReview}
              disabled={reviewRunning || compVideos === 0}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all"
              style={{
                background: 'rgba(168,85,247,0.08)',
                color: '#a855f7',
                borderColor: 'rgba(168,85,247,0.3)',
                opacity: (reviewRunning || compVideos === 0) ? 0.4 : 1
              }}
            >
              {reviewRunning ? (
                <><Loader2 size={13} className="spin" /> Đang review...</>
              ) : (
                <><ScanEye size={13} /> Review Vision AI</>
              )}
            </button>

            {compVideos > 0 && (
              <button
                onClick={downloadAllDoneVideos}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all"
                style={{ background: 'rgba(34,197,94,0.08)', color: 'var(--green)', borderColor: 'rgba(34,197,94,0.3)' }}
              >
                <Download size={13} /> Tải {compVideos} video
              </button>
            )}

            <button
              onClick={openOutputDir}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <FolderOpen size={13} /> Mở thư mục
            </button>

            {compVideos > 0 && compUpscales < compVideos && (
              <button
                onClick={upscaleAllVideos}
                disabled={batchRunning}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.06)]"
                style={{ color: 'var(--yellow)', opacity: batchRunning ? 0.5 : 1 }}
              >
                <Zap size={12} /> Nâng cấp 4K ({compVideos - compUpscales})
              </button>
            )}

            {!isSandbox && (
              <button
                onClick={generateAllVideos}
                disabled={batchRunning || readyToAnimate === 0}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white transition-all shadow-lg"
                style={{
                  background: 'var(--accent)',
                  opacity: (batchRunning || readyToAnimate === 0) ? 0.5 : 1,
                  cursor: (batchRunning || readyToAnimate === 0) ? 'not-allowed' : 'pointer'
                }}
              >
                {batchRunning && batchType === 'GENERATE_VIDEO' ? (
                  <><Loader2 size={13} className="spin" /> Đang tạo video...</>
                ) : (
                  <><Play size={12} fill="#fff" /> Tạo tất cả video ({readyToAnimate})</>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Batch status bar */}
        {batchRunning && batchStatus && batchStatus.total > 0 && pipelineStage === 'idle' && (
          <div className="p-3 rounded-lg flex flex-col gap-1.5 text-xs" style={{ background: 'rgba(124,91,245,0.06)', border: '1px solid rgba(124,91,245,0.15)' }}>
            <div className="flex justify-between" style={{ color: 'var(--accent)' }}>
              <span className="font-semibold flex items-center gap-1">
                <Loader2 size={11} className="spin" /> Hàng chờ render: {batchType}
              </span>
              <span>{batchStatus.completed}/{batchStatus.total} hoàn thành</span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--surface)' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.round((batchStatus.completed / batchStatus.total) * 100)}%`,
                  background: 'var(--accent)',
                  transition: 'width 0.4s'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Video Scene Grid ──────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4">
        {totalScenes > 0 && (
          <h2 className="text-sm font-bold tracking-wider uppercase flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
            <Film size={13} /> {isSandbox ? `Video đã tạo (${totalScenes})` : `Phân cảnh (${totalScenes})`}
          </h2>
        )}

        {totalScenes === 0 ? (
          <div className="rounded-xl py-16 flex flex-col items-center justify-center gap-3 border border-dashed" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
            <Clapperboard size={40} style={{ color: 'var(--border)' }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
              {isSandbox ? 'Nhập prompt và bấm "Tạo hàng loạt" để bắt đầu' : 'Chưa có phân cảnh nào'}
            </span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {isSandbox ? 'Video sẽ hiện ngay bên dưới sau khi tạo xong' : 'Thêm phân cảnh từ trang Studio'}
            </span>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))' }}>
            {scenes.map(s => {
              const imgStatus = s[`${ori}_image_status` as keyof Scene] as StatusType ?? 'PENDING'
              const imgUrl = s[`${ori}_image_url` as keyof Scene] as string | null

              const vidStatus = s[`${ori}_video_status` as keyof Scene] as StatusType ?? 'PENDING'
              const vidUrl = s[`${ori}_video_url` as keyof Scene] as string | null

              const upsStatus = s[`${ori}_upscale_status` as keyof Scene] as StatusType ?? 'PENDING'
              const upsUrl = s[`${ori}_upscale_url` as keyof Scene] as string | null

              const displayVideo = upsUrl || vidUrl
              const displayStatus = (upsStatus === 'PROCESSING' || upsStatus === 'PENDING' || upsUrl) ? upsStatus : vidStatus

              const promptVal = editedPrompts[s.id] ?? ''
              const hasPromptChanged = !isSandbox && promptVal !== (s.video_prompt ?? '')

              const isImageReady = imgStatus === 'COMPLETED'
              const isVideoProcessing = vidStatus === 'PROCESSING' || vidStatus === 'PENDING'
              const isUpscaleProcessing = upsStatus === 'PROCESSING' || upsStatus === 'PENDING'
              const isAnyProcessing = isVideoProcessing || isUpscaleProcessing

              const sceneReview = videoReview?.scene_reviews.find(sr => sr.scene_id === s.id)
              const showReview = showReviewDetails[s.id]

              return (
                <div
                  key={s.id}
                  className="rounded-xl flex flex-col overflow-hidden transition-all group"
                  style={{
                    background: 'var(--card)',
                    border: `1px solid ${
                      vidStatus === 'FAILED' || upsStatus === 'FAILED' ? 'rgba(239,68,68,0.3)'
                      : isAnyProcessing ? 'rgba(124,91,245,0.3)'
                      : vidStatus === 'COMPLETED' ? 'rgba(124,91,245,0.15)'
                      : 'var(--border)'
                    }`,
                    boxShadow: isAnyProcessing ? '0 0 12px rgba(124,91,245,0.06)' : 'none'
                  }}
                >
                  {/* Card Header */}
                  <div
                    className="px-3 py-2 flex items-center justify-between text-xs"
                    style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
                  >
                    <span className="font-bold" style={{ color: 'var(--accent)' }}>
                      {isSandbox ? `Video #${s.display_order + 1}` : `Cảnh #${s.display_order + 1}`}
                    </span>

                    {!isSandbox && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(124,91,245,0.06)', color: 'var(--muted)' }}>
                        {s.chain_type}
                      </span>
                    )}

                    <div className="flex items-center gap-1.5">
                      {upsUrl && (
                        <span className="inline-flex items-center gap-0.5 px-1 rounded text-[9px] font-bold text-yellow-500 bg-yellow-500/10 border border-yellow-500/20">
                          <Zap size={8} /> 4K
                        </span>
                      )}
                      <span
                        className="font-bold px-1.5 py-0.5 rounded text-[10px]"
                        style={{
                          background:
                            displayStatus === 'COMPLETED' ? 'rgba(34,197,94,0.1)'
                            : displayStatus === 'FAILED' ? 'rgba(239,68,68,0.1)'
                            : 'rgba(245,158,11,0.1)',
                          color:
                            displayStatus === 'COMPLETED' ? 'var(--green)'
                            : displayStatus === 'FAILED' ? 'var(--red)'
                            : 'var(--yellow)'
                        }}
                      >
                        {displayStatus === 'COMPLETED' ? 'Video xong'
                          : displayStatus === 'FAILED' ? 'Lỗi render'
                          : displayStatus === 'PROCESSING' ? (isUpscaleProcessing ? 'Upscale 4K' : 'Đang render')
                          : 'Chờ'}
                      </span>
                      {/* Sandbox delete */}
                      {isSandbox && (
                        <button
                          onClick={() => deleteSandboxScene(s.id)}
                          className="p-0.5 rounded hover:bg-[rgba(239,68,68,0.15)] transition-all"
                          style={{ color: 'var(--muted)' }}
                          title="Xóa"
                        >
                          <X size={11} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card Body */}
                  <div className="p-3 flex gap-3 flex-col h-full justify-between">
                    {/* Video Preview Box */}
                    <div
                      className="rounded-lg overflow-hidden border border-dashed relative flex items-center justify-center group/video"
                      style={{
                        aspectRatio: orientation === 'VERTICAL' ? '9/16' : '16/9',
                        maxHeight: 180,
                        background: 'var(--surface)',
                        borderColor: 'var(--border)'
                      }}
                    >
                      {displayVideo ? (
                        <div
                          className="relative w-full h-full cursor-pointer"
                          onClick={() => setPreviewVideoUrl(displayVideo)}
                        >
                          {imgUrl && <img src={imgUrl} alt="Thumbnail" className="w-full h-full object-cover" />}
                          <div className="absolute inset-0 flex items-center justify-center bg-[rgba(0,0,0,0.35)] group-hover/video:bg-[rgba(0,0,0,0.5)] transition-all">
                            {isUpscaleProcessing ? (
                              <div className="flex flex-col items-center gap-1.5 text-center p-2">
                                <Loader2 size={18} className="spin" style={{ color: 'var(--yellow)' }} />
                                <span className="text-[10px] font-bold" style={{ color: 'var(--yellow)' }}>Upscale 4K...</span>
                              </div>
                            ) : (
                              <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[rgba(255,255,255,0.15)] backdrop-blur group-hover/video:scale-110 transition-transform">
                                <Play size={16} color="#fff" fill="#fff" />
                              </div>
                            )}
                          </div>
                          {upsUrl && (
                            <div className="absolute top-2 left-2 flex items-center gap-0.5 rounded px-1 py-0.5 text-[9px] font-semibold text-yellow-400 bg-[rgba(0,0,0,0.7)]">
                              <Zap size={8} /> 4K
                            </div>
                          )}
                        </div>
                      ) : isAnyProcessing ? (
                        <div className="flex flex-col items-center gap-2 p-2 text-center">
                          <Loader2 size={20} className="spin" style={{ color: 'var(--accent)' }} />
                          <span className="text-[10px] font-semibold" style={{ color: 'var(--accent)' }}>
                            {isVideoProcessing ? 'Đang tạo hoạt ảnh...' : 'Đang nâng cấp 4K...'}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              cancelActiveRequest(s.id, isVideoProcessing ? 'GENERATE_VIDEO' : 'UPSCALE_VIDEO')
                            }}
                            className="mt-1.5 px-2 py-0.5 text-[9px] font-semibold rounded border hover:bg-[rgba(239,68,68,0.15)] flex items-center gap-0.5"
                            style={{ color: 'var(--red)', borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)' }}
                          >
                            <XCircle size={10} /> Hủy
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1 p-2 text-center text-xs" style={{ color: 'var(--muted)' }}>
                          <Film size={20} />
                          {!isImageReady ? (
                            <span style={{ color: 'var(--yellow)' }}>
                              {isSandbox ? 'Đang chờ ảnh...' : 'Cần tạo ảnh trước'}
                            </span>
                          ) : vidStatus === 'FAILED' ? (
                            <span style={{ color: 'var(--red)' }}>Lỗi render</span>
                          ) : (
                            <span>Chưa có video</span>
                          )}
                        </div>
                      )}

                      {displayVideo && displayStatus === 'COMPLETED' && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            downloadSingleVideo(s)
                          }}
                          className="absolute top-2 right-2 p-1.5 rounded-full text-white bg-[rgba(0,0,0,0.6)] hover:bg-[rgba(0,0,0,0.85)] border border-[rgba(255,255,255,0.08)] shadow"
                          title="Tải video"
                        >
                          <Download size={11} />
                        </button>
                      )}
                    </div>

                    {/* AI Vision Review */}
                    {sceneReview && (
                      <div className="flex flex-col gap-1.5 p-2 rounded-lg" style={{ background: 'rgba(168,85,247,0.06)', border: '1px solid rgba(168,85,247,0.15)' }}>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: '#a855f7' }}>
                            <ScanEye size={11} /> Vision: {sceneReview.overall_score.toFixed(1)}/10
                          </span>
                          <span className="text-[9px] uppercase font-bold px-1 rounded" style={{ background: 'rgba(168,85,247,0.12)', color: '#a855f7' }}>
                            {sceneReview.verdict}
                          </span>
                          <button
                            onClick={() => setShowReviewDetails(prev => ({ ...prev, [s.id]: !prev[s.id] }))}
                            className="text-[9px] font-semibold underline ml-auto"
                            style={{ color: 'var(--accent)' }}
                          >
                            {showReview ? 'Ẩn' : 'Chi tiết'}
                          </button>
                        </div>
                        {showReview && (
                          <div className="flex flex-col gap-1 mt-1 text-[10px] pl-1.5" style={{ borderLeft: '1px solid rgba(168,85,247,0.3)', color: 'var(--muted)' }}>
                            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[9px]">
                              <span>Nhân vật: {sceneReview.dimensions.character_consistency}/10</span>
                              <span>Prompt: {sceneReview.dimensions.prompt_adherence}/10</span>
                              <span>Chuyển động: {sceneReview.dimensions.motion_quality}/10</span>
                              <span>Độ nét: {sceneReview.dimensions.visual_fidelity}/10</span>
                            </div>
                            {sceneReview.errors.length > 0 && (
                              <div className="mt-1 flex flex-col gap-0.5">
                                <span className="font-semibold text-red-400">Phát hiện lỗi:</span>
                                {sceneReview.errors.map((e, idx) => (
                                  <span key={idx} className="text-red-300">• {e.description} ({e.time_range})</span>
                                ))}
                              </div>
                            )}
                            {sceneReview.fix_guide && (
                              <div className="mt-1 p-1.5 rounded" style={{ background: 'rgba(0,0,0,0.2)', fontStyle: 'italic' }}>
                                <span className="font-semibold block" style={{ color: 'var(--accent)' }}>Fix Guide:</span>
                                {sceneReview.fix_guide}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Motion Prompt (project mode) */}
                    {!isSandbox && (
                      <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                          Video Prompt
                        </label>
                        <textarea
                          rows={3}
                          value={promptVal}
                          onChange={e => setEditedPrompts(prev => ({ ...prev, [s.id]: e.target.value }))}
                          placeholder="Mô tả chuyển động máy quay, hành động nhân vật..."
                          className="w-full text-xs p-2 rounded-lg outline-none resize-none border"
                          style={{
                            background: 'var(--surface)',
                            color: 'var(--text)',
                            borderColor: hasPromptChanged ? 'var(--accent)' : 'var(--border)',
                          }}
                        />
                      </div>
                    )}

                    {/* Sandbox: show prompt preview */}
                    {isSandbox && (
                      <p className="text-[11px] line-clamp-2" style={{ color: 'var(--muted)' }}>
                        {s.video_prompt ?? s.prompt ?? ''}
                      </p>
                    )}

                    {/* Card Footer Actions */}
                    <div className="flex items-center justify-between gap-2 mt-1">
                      {!isSandbox && (
                        <div className="flex items-center gap-1.5">
                          {hasPromptChanged && (
                            <button
                              onClick={() => savePrompt(s.id, false)}
                              disabled={savingPrompts[s.id]}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-white"
                              style={{ background: 'var(--accent)' }}
                            >
                              {savingPrompts[s.id] ? <Loader2 size={10} className="spin" /> : <Save size={10} />}
                              Lưu
                            </button>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-1.5 ml-auto">
                        {/* Upscale trigger */}
                        {vidStatus === 'COMPLETED' && upsStatus !== 'COMPLETED' && (
                          <button
                            onClick={() => triggerSingleUpscale(s.id)}
                            disabled={isUpscaleProcessing}
                            className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border border-yellow-500 text-yellow-500 hover:bg-yellow-500/10"
                          >
                            <Zap size={9} /> 4K
                          </button>
                        )}

                        {vidStatus === 'FAILED' ? (
                          <button
                            onClick={() => triggerSingleVideoGen(s.id, true)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold text-white"
                            style={{ background: 'var(--red)' }}
                          >
                            <RotateCcw size={10} /> Thử lại
                          </button>
                        ) : vidStatus === 'COMPLETED' ? (
                          <button
                            onClick={() => !isSandbox && hasPromptChanged ? savePrompt(s.id, true) : triggerSingleVideoGen(s.id, true)}
                            disabled={isAnyProcessing || savingPrompts[s.id]}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold border hover:bg-[rgba(124,91,245,0.06)]"
                            style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                          >
                            <RefreshCw size={10} /> Tạo lại
                          </button>
                        ) : (
                          <button
                            onClick={() => !isSandbox && hasPromptChanged ? savePrompt(s.id, true) : triggerSingleVideoGen(s.id, false)}
                            disabled={isAnyProcessing || !isImageReady || savingPrompts[s.id]}
                            className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold text-white transition-all"
                            style={{
                              background: 'var(--accent)',
                              opacity: (isAnyProcessing || !isImageReady) ? 0.4 : 1,
                              cursor: (isAnyProcessing || !isImageReady) ? 'not-allowed' : 'pointer'
                            }}
                          >
                            <Play size={10} fill="#fff" /> Tạo video
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
