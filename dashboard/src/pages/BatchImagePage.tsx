import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ImagePlus, Sparkles, Play, X, ChevronLeft, Save,
  RefreshCw, XCircle, Download, Loader2, MapPin, User, RotateCcw,
  Layers, CheckCircle2, AlertCircle, Clock, Zap, Plus, Trash2, FileUp
} from 'lucide-react'
import { fetchAPI, postAPI, patchAPI, deleteAPI } from '../api/client'
import { useWebSocket } from '../api/useWebSocket'
import { useDownload, buildFilename } from '../api/useDownload'
import type { Project, Video, Scene, Character, StatusType } from '../types'

interface BatchStatus {
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  done: boolean
  all_succeeded: boolean
  worker_paused?: boolean
  blocked?: boolean
  last_error?: string | null
}

export default function BatchImagePage() {
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
  const [characters, setCharacters] = useState<Character[]>([])
  const [loading, setLoading] = useState(true)

  // Prompt edit states (for project mode cards)
  const [editedPrompts, setEditedPrompts] = useState<Record<string, string>>({})
  const [savingPrompts, setSavingPrompts] = useState<Record<string, boolean>>({})

  // Lightbox Modal
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null)

  // Batch Job Polling
  const [batchRunning, setBatchRunning] = useState(false)
  const [batchStatus, setBatchStatus] = useState<BatchStatus | null>(null)
  const [batchType, setBatchType] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Sandbox batch input — list of prompt strings
  const [batchPrompts, setBatchPrompts] = useState<string[]>([''])
  const [triggering, setTriggering] = useState(false)

  // File import ref
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Parse TXT / CSV file into a list of prompt strings
  function parseImportFile(text: string, filename: string): string[] {
    const ext = filename.split('.').pop()?.toLowerCase()
    if (ext === 'csv') {
      return text
        .split('\n')
        .map(line => {
          const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''))
          // If 2+ columns: treat col[1] as prompt (col[0] may be a name/index)
          // If 1 column: treat col[0] as prompt
          return cols.length >= 2 ? cols[1] : cols[0]
        })
        .filter(p => p && p.toLowerCase() !== 'prompt' && p.toLowerCase() !== 'description')
    }
    // Default TXT: one prompt per line
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
    // Reset so same file can be re-imported
    e.target.value = ''
  }

  // Sandbox orientation toggle
  const [sandboxOrientation, setSandboxOrientation] = useState<'VERTICAL' | 'HORIZONTAL'>('VERTICAL')

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
        title: 'Batch Ảnh',
        description: 'Sandbox Batch Image Video',
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
        // Use already-resolved IDs or resolve now
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

      const [proj, v, vids, scs, chars] = await Promise.all([
        fetchAPI<Project>(`/api/projects/${targetProjId}`),
        fetchAPI<Video>(`/api/videos/${targetVidId}`),
        fetchAPI<Video[]>(`/api/videos?project_id=${targetProjId}`),
        fetchAPI<Scene[]>(`/api/scenes?video_id=${targetVidId}`),
        fetchAPI<Character[]>(`/api/projects/${targetProjId}/characters`)
      ])
      setProject(proj)
      setVideo(v)
      setVideos(vids)

      if (isSandbox) {
        setScenes(scs.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()))
      } else {
        setScenes(scs.sort((a, b) => a.display_order - b.display_order))
      }

      setCharacters(chars)

      // Sync local prompts dictionary if not already edited (project mode)
      if (!isSandbox) {
        const promptDict: Record<string, string> = {}
        scs.forEach(s => {
          promptDict[s.id] = s.image_prompt ?? ''
        })
        setEditedPrompts(prev => ({ ...promptDict, ...prev }))
      }
    } catch (err) {
      console.error('Failed to load Batch Image data:', err)
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
    if (['scene_updated', 'character_updated', 'request_completed', 'request_failed', 'urls_refreshed'].includes(t)) {
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
  const startStatusPolling = (type: string, queryParam: string, since: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    setBatchRunning(true)
    setBatchType(type)

    const poll = async () => {
      try {
        const s = await fetchAPI<BatchStatus>(
          `/api/requests/batch-status?${queryParam}&type=${type}&since=${encodeURIComponent(since)}`
        )
        setBatchStatus(s)
        if (s.blocked) {
          if (pollRef.current) clearInterval(pollRef.current)
          setBatchRunning(false)
          setBatchType(null)
          loadData(true)
          return
        }
        if (s.done) {
          if (pollRef.current) clearInterval(pollRef.current)
          setBatchRunning(false)
          setBatchType(null)
          setBatchStatus(null)
          loadData(true)
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

  // ── Sandbox Batch Submit ──────────────────────────────────────────────────
  async function handleBatchSubmit() {
    const validPrompts = batchPrompts.filter(p => p.trim())
    if (validPrompts.length === 0) return
    setTriggering(true)
    try {
      let rProjId = sandboxProjId
      let rVidId = sandboxVidId
      if (!rProjId || !rVidId) {
        const resolved = await resolveSandbox()
        if (!resolved) return
        rProjId = resolved.projId
        rVidId = resolved.vidId
      }

      // Update orientation if changed
      if (video && video.orientation !== orientation) {
        await patchAPI(`/api/videos/${rVidId}`, { orientation })
      }

      const since = new Date().toISOString()

      // Create all scenes in parallel
      const createdScenes = await Promise.all(
        validPrompts.map((prompt, idx) =>
          postAPI<Scene>('/api/scenes', {
            video_id: rVidId,
            display_order: scenes.length + idx,
            chain_type: 'ROOT',
            prompt: prompt.trim(),
            image_prompt: prompt.trim(),
            video_prompt: null
          })
        )
      )

      // Submit batch image generation for all created scenes
      await postAPI('/api/requests/batch', {
        requests: createdScenes.map(scene => ({
          type: 'GENERATE_IMAGE',
          scene_id: scene.id,
          project_id: rProjId,
          video_id: rVidId,
          orientation: orientation
        }))
      })

      // Clear prompts
      setBatchPrompts([''])
      startStatusPolling('GENERATE_IMAGE', `video_id=${rVidId}`, since)
      loadData(true)
    } catch (e) {
      console.error('Failed to submit batch images:', e)
    } finally {
      setTriggering(false)
    }
  }

  // ── Project mode actions ──────────────────────────────────────────────────

  async function savePrompt(sceneId: string, immediateGen = false) {
    const text = editedPrompts[sceneId] ?? ''
    setSavingPrompts(prev => ({ ...prev, [sceneId]: true }))
    try {
      await patchAPI(`/api/scenes/${sceneId}`, {
        image_prompt: text.trim() || null
      })
      setScenes(prev => prev.map(s => s.id === sceneId ? { ...s, image_prompt: text.trim() } : s))
      if (immediateGen) await triggerSingleImageGen(sceneId, true)
    } catch (e) {
      console.error('Failed to save image prompt:', e)
    } finally {
      setSavingPrompts(prev => ({ ...prev, [sceneId]: false }))
    }
  }

  async function triggerSingleImageGen(sceneId: string, regen = false) {
    const pId = isSandbox ? sandboxProjId : projectId
    const vId = isSandbox ? sandboxVidId : videoId
    if (!pId || !vId) return
    try {
      await postAPI('/api/requests/batch', {
        requests: [{
          type: regen ? 'REGENERATE_IMAGE' : 'GENERATE_IMAGE',
          scene_id: sceneId,
          project_id: pId,
          video_id: vId,
          orientation: orientation.toUpperCase(),
        }]
      })
      loadData(true)
    } catch (e) {
      console.error('Failed to generate single image:', e)
    }
  }

  async function generateAllImages() {
    const pId = isSandbox ? sandboxProjId : projectId
    const vId = isSandbox ? sandboxVidId : videoId
    if (!pId || !vId || scenes.length === 0) return
    const need = scenes.filter(s => {
      const status = s[`${ori}_image_status` as keyof Scene] as StatusType ?? 'PENDING'
      return status !== 'COMPLETED' && status !== 'PROCESSING'
    })
    if (need.length === 0) return

    setBatchRunning(true)
    try {
      const since = new Date().toISOString()
      await postAPI('/api/requests/batch', {
        requests: need.map(s => ({
          type: 'GENERATE_IMAGE',
          scene_id: s.id,
          project_id: pId,
          video_id: vId,
          orientation: orientation.toUpperCase(),
        }))
      })
      startStatusPolling('GENERATE_IMAGE', `video_id=${vId}`, since)
    } catch (e) {
      console.error('Failed to submit batch image requests:', e)
      setBatchRunning(false)
    }
  }

  async function generateMissingRefs() {
    const pId = isSandbox ? sandboxProjId : projectId
    if (!pId) return
    const missing = characters.filter(c => !c.media_id)
    if (missing.length === 0) return

    setBatchRunning(true)
    try {
      const since = new Date().toISOString()
      await postAPI('/api/requests/batch', {
        requests: missing.map(c => ({
          type: 'GENERATE_CHARACTER_IMAGE',
          character_id: c.id,
          project_id: pId,
          orientation: c.entity_type === 'location' ? 'HORIZONTAL' : 'VERTICAL',
        }))
      })
      startStatusPolling('GENERATE_CHARACTER_IMAGE', `project_id=${pId}`, since)
    } catch (e) {
      console.error('Failed to generate missing reference images:', e)
      setBatchRunning(false)
    }
  }

  async function triggerSingleRefGen(charId: string, isLocation: boolean) {
    const pId = isSandbox ? sandboxProjId : projectId
    if (!pId) return
    try {
      await postAPI('/api/requests/batch', {
        requests: [{
          type: 'GENERATE_CHARACTER_IMAGE',
          character_id: charId,
          project_id: pId,
          orientation: isLocation ? 'HORIZONTAL' : 'VERTICAL',
        }]
      })
      loadData(true)
    } catch (e) {
      console.error('Failed to generate character image:', e)
    }
  }

  async function cancelActiveRequest(sceneId: string, type: 'GENERATE_IMAGE' | 'GENERATE_CHARACTER_IMAGE') {
    try {
      await postAPI(`/api/requests/cancel-active?scene_id=${sceneId}&type=${type}&orientation=${orientation.toUpperCase()}`, {})
      loadData(true)
    } catch (e) {
      console.error('Failed to cancel active request:', e)
    }
  }

  async function cancelAllActive() {
    const pId = isSandbox ? sandboxProjId : projectId
    const vId = isSandbox ? sandboxVidId : videoId
    if (!pId || !vId) return
    const activeScenes = scenes.filter(s => {
      const status = s[`${ori}_image_status` as keyof Scene] as StatusType ?? 'PENDING'
      return status === 'PROCESSING' || status === 'PENDING'
    })
    stopPolling()
    for (const s of activeScenes) {
      await cancelActiveRequest(s.id, 'GENERATE_IMAGE')
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

  async function downloadSingleImage(scene: Scene) {
    const url = scene[`${ori}_image_url` as keyof Scene] as string | null
    if (!url || !project) return
    try {
      await saveFile({
        url,
        filename: buildFilename(scene.display_order, 'image', 'jpg'),
        projectName: isSandbox ? 'batch-studio' : project.name,
        sceneName: `canh-${scene.display_order + 1}`
      })
    } catch (e) {
      console.error('Failed to download image:', e)
    }
  }

  async function downloadAllDoneImages() {
    const items = scenes
      .map(s => {
        const url = s[`${ori}_image_url` as keyof Scene] as string | null
        return {
          url,
          filename: buildFilename(s.display_order, 'image', 'jpg'),
          projectName: isSandbox ? 'batch-studio' : (project?.name ?? 'project')
        }
      })
      .filter(x => !!x.url) as { url: string; filename: string; projectName: string }[]
    if (items.length > 0) {
      await saveBatch({ items, projectName: isSandbox ? 'batch-studio' : (project?.name ?? 'project') })
    }
  }

  if (loading) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
        <Loader2 size={32} className="spin text-accent" style={{ color: 'var(--accent)' }} />
        <span className="text-sm" style={{ color: 'var(--muted)' }}>Đang chuẩn bị Batch Studio...</span>
      </div>
    )
  }

  // Stats calculation
  const totalScenes = scenes.length
  const compScenes = scenes.filter(s => (s[`${ori}_image_status` as keyof Scene] as StatusType) === 'COMPLETED').length
  const procScenes = scenes.filter(s => (s[`${ori}_image_status` as keyof Scene] as StatusType) === 'PROCESSING').length
  const pendScenes = scenes.filter(s => (s[`${ori}_image_status` as keyof Scene] as StatusType) === 'PENDING').length
  const failScenes = scenes.filter(s => (s[`${ori}_image_status` as keyof Scene] as StatusType) === 'FAILED').length
  const progressPct = totalScenes > 0 ? Math.round((compScenes / totalScenes) * 100) : 0
  const missingRefs = characters.filter(c => !c.media_id).length
  const validBatchPrompts = batchPrompts.filter(p => p.trim()).length

  return (
    <div className="flex flex-col gap-5 h-full">
      {/* Lightbox Modal */}
      {lightboxUrl && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.94)' }} onClick={() => setLightboxUrl(null)}>
          <div className="relative flex flex-col items-center gap-2" style={{ maxWidth: '90%', maxHeight: '90%' }}>
            <button className="absolute -top-10 right-0 flex items-center gap-1 text-xs px-2 py-1 rounded bg-[rgba(255,255,255,0.1)] text-white">
              <X size={14} /> Đóng
            </button>
            <img src={lightboxUrl} alt="Preview" className="rounded-lg shadow-2xl max-h-[82vh] object-contain border border-[rgba(255,255,255,0.08)]" />
          </div>
        </div>
      )}

      {/* Header & Breadcrumb */}
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
          <span style={{ color: 'var(--muted)', fontSize: 12 }}>Batch Ảnh</span>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 mt-1">
          <div>
            <h1 className="text-xl font-bold tracking-tight flex items-center gap-2" style={{ color: 'var(--text)' }}>
              <ImagePlus size={22} style={{ color: 'var(--green)' }} />
              {isSandbox ? 'Batch Tạo Ảnh Nhanh' : 'Batch Tạo Ảnh Số Lượng Lớn'}
            </h1>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {isSandbox ? (
                <span className="flex items-center gap-1">
                  <Zap size={11} /> Tạo ảnh hàng loạt độc lập — không cần tạo dự án
                </span>
              ) : (
                <span>Dự án: <span className="font-semibold" style={{ color: 'var(--text)' }}>{project?.name}</span> • Tập: <span className="font-semibold" style={{ color: 'var(--text)' }}>{video?.title}</span> ({orientation})</span>
              )}
            </p>
          </div>

          {/* Quick switcher to other episodes */}
          {!isSandbox && videos.length > 1 && (
            <div className="flex items-center gap-1.5 text-xs">
              <span style={{ color: 'var(--muted)' }}>Chọn tập khác:</span>
              <select
                value={videoId}
                onChange={e => navigate(`/batch-images/${projectId}/${e.target.value}`)}
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
              <Layers size={15} style={{ color: 'var(--green)' }} />
              <span className="text-sm font-bold" style={{ color: 'var(--text)' }}>
                Nhập danh sách ý tưởng ảnh
              </span>
              <span className="text-xs px-2 py-0.5 rounded-full font-semibold" style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--green)' }}>
                {validBatchPrompts} ảnh sẽ tạo
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
                    background: sandboxOrientation === 'VERTICAL' ? 'var(--green)' : 'var(--surface)',
                    color: sandboxOrientation === 'VERTICAL' ? '#fff' : 'var(--muted)'
                  }}
                >
                  Dọc 9:16
                </button>
                <button
                  onClick={() => setSandboxOrientation('HORIZONTAL')}
                  className="px-3 py-1.5 font-semibold transition-all"
                  style={{
                    background: sandboxOrientation === 'HORIZONTAL' ? 'var(--green)' : 'var(--surface)',
                    color: sandboxOrientation === 'HORIZONTAL' ? '#fff' : 'var(--muted)'
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
                  style={{ background: 'rgba(34,197,94,0.12)', color: 'var(--green)' }}
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
                  placeholder={`Prompt ảnh #${idx + 1}: Mô tả bối cảnh, ánh sáng, góc máy...`}
                  className="flex-1 text-sm p-2.5 rounded-lg outline-none resize-none border"
                  style={{
                    background: 'var(--surface)',
                    color: 'var(--text)',
                    borderColor: prompt.trim() ? 'rgba(34,197,94,0.3)' : 'var(--border)',
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
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border hover:bg-[rgba(34,197,94,0.06)] transition-all"
                style={{ borderColor: 'rgba(34,197,94,0.25)', color: 'var(--green)' }}
              >
                <Plus size={13} /> Thêm ảnh
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
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border hover:bg-[rgba(34,197,94,0.06)] transition-all"
                style={{ borderColor: 'rgba(34,197,94,0.25)', color: 'var(--green)' }}
                title="Import danh sách từ file TXT hoặc CSV (mỗi dòng = 1 prompt)"
              >
                <FileUp size={13} /> Import TXT/CSV
              </button>
            </div>

            <button
              onClick={handleBatchSubmit}
              disabled={triggering || validBatchPrompts === 0 || batchRunning}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-bold text-white transition-all shadow-lg"
              style={{
                background: validBatchPrompts > 0 ? 'var(--green)' : 'var(--surface)',
                opacity: (triggering || validBatchPrompts === 0 || batchRunning) ? 0.5 : 1,
                cursor: (triggering || validBatchPrompts === 0 || batchRunning) ? 'not-allowed' : 'pointer'
              }}
            >
              {triggering ? (
                <><Loader2 size={15} className="spin" /> Đang gửi...</>
              ) : (
                <><Sparkles size={14} fill="#fff" /> Tạo {validBatchPrompts} ảnh hàng loạt</>
              )}
            </button>
          </div>

          {/* Help hint */}
          <p className="text-[11px]" style={{ color: 'var(--muted)' }}>
            Mỗi ô là một ảnh độc lập. Hệ thống sẽ tạo tất cả cùng lúc (tối đa 5 song song).
          </p>
        </div>
      )}

      {/* ── Bulk Progress & Control Dashboard ──────────────────────────────── */}
      <div
        className="rounded-xl p-4 flex flex-col gap-4"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Progress Breakdown */}
          <div className="flex-1 min-w-[280px]">
            <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
              <span className="flex items-center gap-1" style={{ color: 'var(--green)' }}>
                <ImagePlus size={13} /> Tiến độ ảnh: {progressPct}%
              </span>
              <span style={{ color: 'var(--muted)' }}>
                {compScenes}/{totalScenes} ảnh
              </span>
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 6, background: 'var(--surface)' }}>
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  background: 'var(--green)',
                  boxShadow: progressPct > 0 ? '0 0 8px var(--green)' : 'none',
                  transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)'
                }}
              />
            </div>
            {/* Legend indicators */}
            <div className="flex gap-4 mt-2 text-xs flex-wrap" style={{ color: 'var(--muted)' }}>
              <span className="flex items-center gap-1"><CheckCircle2 size={11} style={{ color: 'var(--green)' }} /> {compScenes} Đã xong</span>
              {procScenes > 0 && <span className="flex items-center gap-1"><Loader2 size={11} className="spin" style={{ color: 'var(--yellow)' }} /> {procScenes} Đang tạo</span>}
              {pendScenes > 0 && <span className="flex items-center gap-1"><Clock size={11} /> {pendScenes} Chờ</span>}
              {failScenes > 0 && <span className="flex items-center gap-1"><AlertCircle size={11} style={{ color: 'var(--red)' }} /> {failScenes} Lỗi</span>}
            </div>
          </div>

          {/* Bulk Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => loadData(false)}
              title="Làm mới"
              className="flex items-center justify-center p-2 rounded-lg border hover:bg-[rgba(255,255,255,0.03)]"
              style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--muted)' }}
            >
              <RefreshCw size={14} />
            </button>

            {(batchRunning || procScenes > 0 || pendScenes > 0) && (
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

            {compScenes > 0 && (
              <button
                onClick={downloadAllDoneImages}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold border transition-all"
                style={{ background: 'rgba(34,197,94,0.08)', color: 'var(--green)', borderColor: 'rgba(34,197,94,0.3)' }}
              >
                <Download size={13} /> Tải {compScenes} ảnh
              </button>
            )}

            {!isSandbox && (
              <button
                onClick={generateAllImages}
                disabled={batchRunning || (compScenes === totalScenes && failScenes === 0 && totalScenes > 0)}
                className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold text-white transition-all shadow-lg"
                style={{
                  background: 'var(--green)',
                  cursor: (batchRunning || (compScenes === totalScenes && failScenes === 0 && totalScenes > 0)) ? 'not-allowed' : 'pointer',
                  opacity: (batchRunning || (compScenes === totalScenes && failScenes === 0 && totalScenes > 0)) ? 0.5 : 1
                }}
              >
                {batchRunning && batchType === 'GENERATE_IMAGE' ? (
                  <><Loader2 size={13} className="spin" /> Đang tạo ảnh...</>
                ) : (
                  <><Play size={12} fill="#fff" /> Tạo tất cả ảnh ({totalScenes - compScenes} còn thiếu)</>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Batch Status Overlay if running */}
        {batchStatus && (batchRunning || batchStatus.blocked) && (
          <div
            className="p-3 rounded-lg flex flex-col gap-1.5"
            style={{
              background: batchStatus.blocked ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)',
              border: `1px solid ${batchStatus.blocked ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.15)'}`,
            }}
          >
            <div className="flex justify-between text-xs" style={{ color: batchStatus.blocked ? 'var(--red)' : 'var(--green)' }}>
              <span className="font-semibold flex items-center gap-1">
                {batchStatus.blocked ? <AlertCircle size={11} /> : <Loader2 size={11} className="spin" />}
                {batchStatus.blocked
                  ? `Tạm dừng: ${batchStatus.last_error || 'Worker paused'}`
                  : `Đang tạo hàng loạt: ${batchStatus.completed}/${batchStatus.total} xong`}
              </span>
              {batchRunning && (
                <button
                  onClick={cancelAllActive}
                  className="flex items-center gap-1 px-2 py-0.5 rounded border text-[10px]"
                  style={{ borderColor: 'rgba(239,68,68,0.4)', color: 'var(--red)', background: 'rgba(239,68,68,0.06)' }}
                >
                  <XCircle size={10} /> Dừng
                </button>
              )}
            </div>
            <div className="rounded-full overflow-hidden" style={{ height: 4, background: 'var(--surface)' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.round((batchStatus.completed / Math.max(batchStatus.total, 1)) * 100)}%`,
                  background: 'var(--green)',
                  transition: 'width 0.4s'
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ── Main Content: Image Grid (LEFT) | Char Refs Sidebar (RIGHT) ────── */}
      <div className="grid gap-5" style={{ gridTemplateColumns: isSandbox ? '1fr' : 'minmax(0, 1fr) 280px' }}>
        {/* Left Side: Images Grid */}
        <div className="flex flex-col gap-4">
          {totalScenes > 0 && (
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold tracking-wider uppercase flex items-center gap-1.5" style={{ color: 'var(--muted)' }}>
                <ImagePlus size={13} />
                {isSandbox ? `Ảnh đã tạo (${totalScenes})` : `Danh sách Phân cảnh (${totalScenes})`}
              </h2>
            </div>
          )}

          {totalScenes === 0 ? (
            <div className="rounded-xl py-16 flex flex-col items-center justify-center gap-3 border border-dashed" style={{ borderColor: 'var(--border)', background: 'var(--card)' }}>
              <ImagePlus size={40} style={{ color: 'var(--border)' }} />
              <span className="text-sm font-semibold" style={{ color: 'var(--muted)' }}>
                {isSandbox ? 'Nhập prompt và bấm "Tạo hàng loạt" để bắt đầu' : 'Chưa có phân cảnh nào'}
              </span>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {isSandbox ? 'Ảnh sẽ hiện ngay bên dưới sau khi tạo' : 'Thêm phân cảnh từ trang Studio'}
              </span>
            </div>
          ) : (
            <div
              className="grid gap-4"
              style={{ gridTemplateColumns: isSandbox ? 'repeat(auto-fill, minmax(220px, 1fr))' : 'repeat(auto-fill, minmax(360px, 1fr))' }}
            >
              {scenes.map(s => {
                const imgStatus = s[`${ori}_image_status` as keyof Scene] as StatusType ?? 'PENDING'
                const imgUrl = s[`${ori}_image_url` as keyof Scene] as string | null
                const promptVal = editedPrompts[s.id] ?? ''
                const hasPromptChanged = !isSandbox && promptVal !== (s.image_prompt ?? '')
                const isProcessing = imgStatus === 'PROCESSING' || imgStatus === 'PENDING'

                // Parse Character Names tags
                let charNames: string[] = []
                try {
                  charNames = s.character_names ? JSON.parse(s.character_names) : []
                } catch (_) {}

                return (
                  <div
                    key={s.id}
                    className="rounded-xl flex flex-col overflow-hidden transition-all group"
                    style={{
                      background: 'var(--card)',
                      border: `1px solid ${
                        imgStatus === 'FAILED' ? 'rgba(239,68,68,0.3)'
                        : isProcessing ? 'rgba(34,197,94,0.3)'
                        : imgStatus === 'COMPLETED' ? 'rgba(34,197,94,0.15)'
                        : 'var(--border)'
                      }`,
                      boxShadow: isProcessing ? '0 0 12px rgba(34,197,94,0.06)' : 'none'
                    }}
                  >
                    {/* Card Header */}
                    <div
                      className="px-3 py-2 flex items-center justify-between text-xs"
                      style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}
                    >
                      <span className="font-bold" style={{ color: 'var(--green)' }}>
                        {isSandbox ? `Ảnh #${s.display_order + 1}` : `Cảnh #${s.display_order + 1}`}
                      </span>

                      {/* Character Tags */}
                      {!isSandbox && charNames.length > 0 && (
                        <div className="flex items-center gap-1 max-w-[50%] overflow-hidden truncate">
                          {charNames.slice(0, 2).map((n, i) => (
                            <span key={i} className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: 'rgba(34,197,94,0.08)', color: 'var(--muted)' }}>
                              {n}
                            </span>
                          ))}
                          {charNames.length > 2 && (
                            <span className="text-[10px]" style={{ color: 'var(--muted)' }}>+{charNames.length - 2}</span>
                          )}
                        </div>
                      )}

                      <div className="flex items-center gap-1">
                        <span
                          className="font-bold px-1.5 py-0.5 rounded text-[10px]"
                          style={{
                            background:
                              imgStatus === 'COMPLETED' ? 'rgba(34,197,94,0.1)'
                              : imgStatus === 'FAILED' ? 'rgba(239,68,68,0.1)'
                              : 'rgba(245,158,11,0.1)',
                            color:
                              imgStatus === 'COMPLETED' ? 'var(--green)'
                              : imgStatus === 'FAILED' ? 'var(--red)'
                              : 'var(--yellow)'
                          }}
                        >
                          {imgStatus === 'COMPLETED' ? 'Xong'
                            : imgStatus === 'FAILED' ? 'Lỗi'
                            : imgStatus === 'PROCESSING' ? 'Đang tạo'
                            : 'Chờ tạo'}
                        </span>

                        {/* Sandbox delete button */}
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
                      {/* Image Preview */}
                      <div
                        className="rounded-lg overflow-hidden border border-dashed relative flex items-center justify-center"
                        style={{
                          aspectRatio: orientation === 'VERTICAL' ? '9/16' : '16/9',
                          maxHeight: isSandbox ? 240 : 180,
                          background: 'var(--surface)',
                          borderColor: 'var(--border)',
                          cursor: imgUrl ? 'zoom-in' : 'default'
                        }}
                        onClick={() => imgUrl && setLightboxUrl(imgUrl)}
                      >
                        {imgUrl ? (
                          <img src={imgUrl} alt={`Ảnh ${s.display_order + 1}`} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        ) : isProcessing ? (
                          <div className="flex flex-col items-center gap-2 p-2 text-center">
                            <Loader2 size={20} className="spin" style={{ color: 'var(--green)' }} />
                            <span className="text-[10px] font-semibold" style={{ color: 'var(--green)' }}>
                              {imgStatus === 'PROCESSING' ? 'Đang sinh ảnh...' : 'Đang chờ xếp hàng...'}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation()
                                cancelActiveRequest(s.id, 'GENERATE_IMAGE')
                              }}
                              className="mt-1.5 px-2 py-0.5 text-[9px] font-semibold rounded border hover:bg-[rgba(239,68,68,0.15)] flex items-center gap-0.5"
                              style={{ color: 'var(--red)', borderColor: 'rgba(239,68,68,0.4)', background: 'rgba(239,68,68,0.08)' }}
                            >
                              <XCircle size={10} /> Hủy
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-1 p-2 text-center text-xs" style={{ color: 'var(--muted)' }}>
                            <ImagePlus size={20} />
                            {imgStatus === 'FAILED' ? (
                              <span style={{ color: 'var(--red)' }}>Lỗi sản xuất</span>
                            ) : (
                              <span>Chưa có ảnh</span>
                            )}
                          </div>
                        )}

                        {/* Download hover button */}
                        {imgUrl && imgStatus === 'COMPLETED' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              downloadSingleImage(s)
                            }}
                            className="absolute top-2 right-2 p-1.5 rounded-full text-white bg-[rgba(0,0,0,0.6)] hover:bg-[rgba(0,0,0,0.85)] border border-[rgba(255,255,255,0.08)] shadow"
                            title="Tải ảnh này về"
                          >
                            <Download size={11} />
                          </button>
                        )}
                      </div>

                      {/* Prompt display for sandbox / editable for project mode */}
                      {isSandbox ? (
                        <p className="text-[11px] line-clamp-2" style={{ color: 'var(--muted)' }}>
                          {s.image_prompt ?? s.prompt ?? ''}
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1">
                          <label className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--muted)' }}>
                            Image Prompt
                          </label>
                          <textarea
                            rows={3}
                            value={promptVal}
                            onChange={e => setEditedPrompts(prev => ({ ...prev, [s.id]: e.target.value }))}
                            placeholder="Mô tả bối cảnh, ánh sáng, góc máy..."
                            className="w-full text-xs p-2 rounded-lg outline-none resize-none border"
                            style={{
                              background: 'var(--surface)',
                              color: 'var(--text)',
                              borderColor: hasPromptChanged ? 'var(--green)' : 'var(--border)',
                            }}
                          />
                        </div>
                      )}

                      {/* Card Footer Actions */}
                      <div className="flex items-center justify-between gap-2 mt-1">
                        {/* Save Prompt (project mode only) */}
                        {!isSandbox && (
                          <div className="flex items-center gap-1.5">
                            {hasPromptChanged && (
                              <button
                                onClick={() => savePrompt(s.id, false)}
                                disabled={savingPrompts[s.id]}
                                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold text-white transition-all"
                                style={{ background: 'var(--green)' }}
                              >
                                {savingPrompts[s.id] ? <Loader2 size={10} className="spin" /> : <Save size={10} />}
                                Lưu
                              </button>
                            )}
                          </div>
                        )}

                        {/* Generation Controls */}
                        <div className="flex items-center gap-1.5 ml-auto">
                          {imgStatus === 'FAILED' ? (
                            <button
                              onClick={() => triggerSingleImageGen(s.id, true)}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold text-white"
                              style={{ background: 'var(--red)' }}
                            >
                              <RotateCcw size={10} /> Thử lại
                            </button>
                          ) : imgStatus === 'COMPLETED' ? (
                            <button
                              onClick={() => !isSandbox && hasPromptChanged ? savePrompt(s.id, true) : triggerSingleImageGen(s.id, true)}
                              disabled={savingPrompts[s.id]}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold border hover:bg-[rgba(34,197,94,0.06)]"
                              style={{ borderColor: 'var(--green)', color: 'var(--green)' }}
                            >
                              <RefreshCw size={10} /> Tạo lại
                            </button>
                          ) : (
                            <button
                              onClick={() => !isSandbox && hasPromptChanged ? savePrompt(s.id, true) : triggerSingleImageGen(s.id, false)}
                              disabled={isProcessing || savingPrompts[s.id]}
                              className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold text-white transition-all"
                              style={{
                                background: 'var(--green)',
                                opacity: isProcessing ? 0.4 : 1,
                                cursor: isProcessing ? 'not-allowed' : 'pointer'
                              }}
                            >
                              <Play size={10} fill="#fff" /> Tạo ảnh
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

        {/* Right Side: Character Reference Sidebar (project mode only) */}
        {!isSandbox && (
          <aside className="flex flex-col gap-4">
            <div
              className="rounded-xl p-3.5 flex flex-col gap-3.5"
              style={{ background: 'var(--card)', border: '1px solid var(--border)', position: 'sticky', top: 0 }}
            >
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: 'var(--text)' }}>
                  <User size={13} /> Ảnh tham chiếu ({characters.length})
                </h3>
                <p style={{ color: 'var(--muted)', fontSize: 10 }}>
                  Mỗi nhân vật cần ảnh để đảm bảo tính đồng nhất hình ảnh.
                </p>
              </div>

              {missingRefs > 0 && (
                <button
                  onClick={generateMissingRefs}
                  disabled={batchRunning}
                  className="w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-[11px] font-bold border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.06)] transition-all hover:bg-[rgba(245,158,11,0.12)]"
                  style={{ color: 'var(--yellow)' }}
                >
                  <Sparkles size={11} /> Tạo {missingRefs} ảnh tham chiếu
                </button>
              )}

              <div className="flex flex-col gap-3 overflow-y-auto max-h-[60vh] pr-1">
                {characters.length === 0 ? (
                  <span className="text-[11px] text-center" style={{ color: 'var(--muted)' }}>
                    Không có nhân vật nào trong dự án.
                  </span>
                ) : (
                  characters.map(c => {
                    const isLoc = c.entity_type === 'location'
                    return (
                      <div
                        key={c.id}
                        className="flex flex-col gap-2 p-2 rounded-lg"
                        style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className="w-10 rounded overflow-hidden flex-shrink-0 flex items-center justify-center border"
                            style={{
                              aspectRatio: '3/4',
                              background: 'var(--card)',
                              borderColor: c.media_id ? 'var(--border)' : 'rgba(239,68,68,0.3)'
                            }}
                          >
                            {c.reference_image_url ? (
                              <img src={c.reference_image_url} alt={c.name} className="w-full h-full object-cover" />
                            ) : (
                              <span style={{ color: 'var(--muted)' }}>{isLoc ? <MapPin size={16} /> : <User size={16} />}</span>
                            )}
                          </div>

                          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                            <span className="text-xs font-semibold truncate" style={{ color: 'var(--text)' }}>
                              {c.name}
                            </span>
                            <span className="text-[10px] capitalize" style={{ color: 'var(--muted)' }}>
                              {c.entity_type}
                            </span>
                            <div className="flex items-center gap-1 mt-0.5">
                              <span
                                className="w-1.5 h-1.5 rounded-full"
                                style={{ background: c.media_id ? 'var(--green)' : 'var(--red)' }}
                              />
                              <span style={{ fontSize: 9, color: c.media_id ? 'var(--green)' : 'var(--red)' }}>
                                {c.media_id ? 'Đã có ref' : 'Chưa có ref'}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => triggerSingleRefGen(c.id, isLoc)}
                          disabled={batchRunning}
                          className="w-full flex items-center justify-center gap-1.5 py-1 rounded text-[10px] font-semibold border hover:bg-[rgba(255,255,255,0.03)]"
                          style={{
                            background: 'var(--card)',
                            borderColor: 'var(--border)',
                            color: 'var(--muted)',
                            cursor: batchRunning ? 'not-allowed' : 'pointer'
                          }}
                        >
                          <RefreshCw size={9} />
                          {c.media_id ? 'Tạo lại ref' : 'Tạo ref ảnh'}
                        </button>
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
