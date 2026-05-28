/**
 * useDownload hook — handles saving media files via backend API
 * Supports: single file save, batch save, browser fallback download
 */
import { useCallback } from 'react'
import { postAPI } from './client'

interface SaveOptions {
  url: string
  filename: string
  projectName: string
  sceneName?: string
}

interface BatchSaveOptions {
  items: SaveOptions[]
  projectName: string
}

export function useDownload() {
  /**
   * Save a single file to the configured download location via backend.
   * Falls back to browser download if backend save fails.
   */
  const saveFile = useCallback(async (opts: SaveOptions): Promise<boolean> => {
    try {
      await postAPI('/api/download/save', {
        url: opts.url,
        filename: opts.filename,
        project_name: opts.projectName,
        scene_name: opts.sceneName,
      })
      return true
    } catch (err) {
      console.warn('Backend save failed, trying browser download:', err)
      // Fallback: browser download
      try {
        const a = document.createElement('a')
        a.href = opts.url
        a.download = opts.filename
        a.click()
        return true
      } catch (_) {
        return false
      }
    }
  }, [])

  /**
   * Save multiple files (batch) to the configured download location.
   */
  const saveBatch = useCallback(async (opts: BatchSaveOptions): Promise<{ saved: number; failed: number }> => {
    try {
      const result = await postAPI<{ saved: number; failed: number; errors: { filename: string; error: string }[] }>(
        '/api/download/save-batch',
        {
          items: opts.items.map(i => ({
            url: i.url,
            filename: i.filename,
            project_name: i.projectName,
            scene_name: i.sceneName,
          })),
          project_name: opts.projectName,
        }
      )
      if (result.errors?.length) {
        console.warn('Some files failed to save:', result.errors)
      }
      return { saved: result.saved, failed: result.failed }
    } catch (err) {
      console.error('Batch save failed:', err)
      // Fallback: trigger individual browser downloads
      let saved = 0
      for (const item of opts.items) {
        try {
          const a = document.createElement('a')
          a.href = item.url
          a.download = item.filename
          a.click()
          saved++
          await new Promise(r => setTimeout(r, 300)) // throttle
        } catch (_) {}
      }
      return { saved, failed: opts.items.length - saved }
    }
  }, [])

  return { saveFile, saveBatch }
}

/**
 * Build a safe filename from components
 * e.g. buildFilename('My Project', 3, 'image') → 'canh-3-anh.jpg'
 */
export function buildFilename(
  sceneOrder: number,
  type: 'image' | 'video' | 'upscale',
  ext?: string
): string {
  const typeLabel = type === 'image' ? 'anh' : type === 'video' ? 'video' : '4k'
  const extension = ext ?? (type === 'image' ? 'jpg' : 'mp4')
  return `canh-${sceneOrder + 1}-${typeLabel}.${extension}`
}
