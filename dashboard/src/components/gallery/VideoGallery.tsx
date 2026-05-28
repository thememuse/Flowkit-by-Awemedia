import { useState } from 'react'
import type { Scene } from '../../types'
import VideoPlayer from './VideoPlayer'

interface VideoGalleryProps {
  scenes: Scene[]
  orientation?: 'VERTICAL' | 'HORIZONTAL'
}

export default function VideoGallery({ scenes, orientation = 'VERTICAL' }: VideoGalleryProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const isHorizontal = orientation === 'HORIZONTAL'
  const prefix = isHorizontal ? 'horizontal' : 'vertical'

  // Filter scenes that actually have the generated video for the current orientation
  const videoscenes = scenes.filter(s => s[`${prefix}_video_url` as keyof Scene])

  if (videoscenes.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 text-xs" style={{ color: 'var(--muted)' }}>
        Chưa có video phân cảnh hoàn thành cho định dạng này.
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 animate-fade-in">
        {videoscenes.map((scene, idx) => {
          const imgUrl = scene[`${prefix}_image_url` as keyof Scene] as string | null
          const hasVideo = scene[`${prefix}_video_url` as keyof Scene]
          const hasUpscale = scene[`${prefix}_upscale_url` as keyof Scene]

          return (
            <div
              key={scene.id}
              className="relative rounded-lg overflow-hidden cursor-pointer transition-all hover:scale-103 shadow-md hover:shadow-lg"
              style={{ border: '1px solid var(--border)', background: 'var(--card)' }}
              onClick={() => setActiveIndex(idx)}
            >
              {/* Thumbnail */}
              <div className="relative" style={{ aspectRatio: isHorizontal ? '16/9' : '9/16' }}>
                {imgUrl ? (
                  <img
                    src={imgUrl}
                    alt={`Scene ${scene.display_order + 1}`}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-xs" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                    Không có ảnh
                  </div>
                )}

                {/* Overlay details */}
                <div className="absolute inset-0 flex flex-col justify-between p-2" style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.4) 0%, transparent 30%, transparent 70%, rgba(0,0,0,0.6) 100%)' }}>
                  <div className="flex items-start justify-between">
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.65)', color: 'var(--text)', border: '1px solid rgba(255,255,255,0.05)' }}>
                      #{scene.display_order + 1}
                    </span>
                    <div className="flex gap-1">
                      {hasVideo && (
                        <span title="Video ready" className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: 'rgba(34,197,94,0.85)', color: '#fff' }}>
                          ✓ Video
                        </span>
                      )}
                      {hasUpscale && (
                        <span title="Upscaled 4K" className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ background: 'rgba(245,158,11,0.85)', color: '#fff' }}>
                          ★ 4K
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-[10px] truncate px-1 py-0.5 rounded font-mono" style={{ background: 'rgba(0,0,0,0.5)', color: 'var(--text-secondary)' }}>
                    {scene.prompt?.slice(0, 45) ?? ''}...
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {activeIndex !== null && (
        <VideoPlayer
          scenes={videoscenes}
          initialIndex={activeIndex}
          onClose={() => setActiveIndex(null)}
          orientation={orientation}
        />
      )}
    </>
  )
}
