import { useState, useEffect } from 'react'
import type { Scene } from '../../types'

interface VideoPlayerProps {
  scenes: Scene[]
  initialIndex: number
  onClose: () => void
  orientation?: 'VERTICAL' | 'HORIZONTAL'
}

function parseCharacterNames(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed
    return []
  } catch {
    return []
  }
}

export default function VideoPlayer({ scenes, initialIndex, onClose, orientation = 'VERTICAL' }: VideoPlayerProps) {
  const [index, setIndex] = useState(initialIndex)
  const scene = scenes[index]

  const isHorizontal = orientation === 'HORIZONTAL'
  const prefix = isHorizontal ? 'horizontal' : 'vertical'

  const videoSrc = (scene[`${prefix}_upscale_url` as keyof Scene] || scene[`${prefix}_video_url` as keyof Scene] || '') as string
  const charNames = parseCharacterNames(scene.character_names)

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && index > 0) setIndex(i => i - 1)
      if (e.key === 'ArrowRight' && index < scenes.length - 1) setIndex(i => i + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, scenes.length, onClose])

  function chainBadgeStyle(ct: string) {
    if (ct === 'ROOT') return { background: 'var(--accent)', color: '#fff' }
    if (ct === 'CONTINUATION') return { background: 'var(--green)', color: '#fff' }
    return { background: 'var(--yellow)', color: '#000' }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.85)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col md:flex-row rounded-xl overflow-hidden relative shadow-2xl animate-fade-in"
        style={{ maxHeight: '90vh', maxWidth: '90vw', background: 'var(--surface)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          className="absolute top-3 right-3 z-10 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors hover:bg-black/80 hover:text-white"
          style={{ background: 'rgba(0,0,0,0.6)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.05)' }}
          onClick={onClose}
        >
          ✕
        </button>

        {/* Video Player Box */}
        <div className="flex items-center justify-center bg-black" style={{ minWidth: 280, maxWidth: isHorizontal ? '55vw' : '30vw', aspectRatio: isHorizontal ? '16/9' : '9/16' }}>
          <video
            key={videoSrc}
            src={videoSrc}
            controls
            autoPlay
            playsInline
            className="w-full h-full object-contain"
          />
        </div>

        {/* Sidebar details */}
        <div
          className="flex flex-col p-5 gap-4 overflow-y-auto"
          style={{ width: 320, background: 'var(--surface)', borderLeft: '1px solid var(--border)' }}
        >
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded border border-white/5" style={{ background: 'var(--card)', color: 'var(--text-secondary)' }}>
              Phân cảnh #{scene.display_order + 1}
            </span>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded" style={chainBadgeStyle(scene.chain_type)}>
              {scene.chain_type}
            </span>
          </div>

          {scene.prompt && (
            <div>
              <div className="text-[10px] font-bold mb-1 tracking-wider uppercase" style={{ color: 'var(--muted)' }}>Ý tưởng hình ảnh (AI Prompt)</div>
              <div className="text-xs leading-relaxed" style={{ color: 'var(--text)' }}>{scene.prompt}</div>
            </div>
          )}

          {scene.video_prompt && (
            <div>
              <div className="text-[10px] font-bold mb-1 tracking-wider uppercase" style={{ color: 'var(--muted)' }}>Mô tả chuyển động (AI Video Prompt)</div>
              <div className="text-xs leading-relaxed font-mono bg-black/25 p-2 rounded border border-white/5" style={{ color: 'var(--text-secondary)' }}>{scene.video_prompt}</div>
            </div>
          )}

          {charNames.length > 0 && (
            <div>
              <div className="text-[10px] font-bold mb-1 tracking-wider uppercase" style={{ color: 'var(--muted)' }}>Nhân vật xuất hiện</div>
              <div className="flex flex-wrap gap-1.5">
                {charNames.map(name => (
                  <span key={name} className="text-xs font-semibold px-2 py-0.5 rounded border border-accent/10" style={{ background: 'rgba(124,91,245,0.06)', color: 'var(--accent)' }}>
                    {name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Download */}
          <a
            href={videoSrc}
            download={`scene-${scene.display_order + 1}.mp4`}
            className="text-xs px-3 py-2 rounded text-center font-bold mt-auto transition-all active:scale-97 text-white"
            style={{ background: 'var(--accent)', textDecoration: 'none' }}
          >
            Tải Video Xuống
          </a>

          {/* Prev / Next navigation */}
          <div className="flex gap-2">
            <button
              disabled={index === 0}
              onClick={() => setIndex(i => i - 1)}
              className="flex-1 text-xs py-2 rounded font-bold transition-all active:scale-97 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
            >
              Cảnh trước
            </button>
            <button
              disabled={index === scenes.length - 1}
              onClick={() => setIndex(i => i + 1)}
              className="flex-1 text-xs py-2 rounded font-bold transition-all active:scale-97 disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
            >
              Cảnh tiếp
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
