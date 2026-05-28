import { useState, useEffect } from 'react'
import { postAPI, fetchAPI } from '../../api/client'
import type { Project } from '../../types'
import { User, MapPin, Rabbit, Box, Sparkles, Plus, Loader2 } from 'lucide-react'

interface Material {
  id: string
  name: string
}

interface CharacterInput {
  name: string
  description: string
  entity_type: 'character' | 'location' | 'creature' | 'visual_asset'
}

interface Props {
  onCreated: (p: Project) => void
  onCancel: () => void
}

const INPUT_STYLE: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  padding: '6px 10px',
  fontSize: 12,
  outline: 'none',
  width: '100%',
}

const ENTITY_TYPES: { type: CharacterInput['entity_type']; label: string; icon: React.ElementType }[] = [
  { type: 'character', label: 'Nhân vật', icon: User },
  { type: 'location', label: 'Địa điểm', icon: MapPin },
  { type: 'creature', label: 'Sinh vật', icon: Rabbit },
  { type: 'visual_asset', label: 'Vật thể', icon: Box },
]

export default function CreateProjectForm({ onCreated, onCancel }: Props) {
  const [name, setName] = useState('')
  const [story, setStory] = useState('')
  const [material, setMaterial] = useState('realistic')
  const [orientation, setOrientation] = useState<'VERTICAL' | 'HORIZONTAL'>('VERTICAL')
  const [characters, setCharacters] = useState<CharacterInput[]>([
    { name: '', description: '', entity_type: 'character' },
  ])
  const [materials, setMaterials] = useState<Material[]>([])
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [step, setStep] = useState<'info' | 'entities'>('info')
  const [language, setLanguage] = useState('vi')

  useEffect(() => {
    fetchAPI<Material[]>('/api/materials').then(setMaterials).catch(() => {})
  }, [])

  function addEntity(type: CharacterInput['entity_type']) {
    setCharacters(prev => [...prev, { name: '', description: '', entity_type: type }])
  }

  function updateEntity(i: number, updates: Partial<CharacterInput>) {
    setCharacters(prev => prev.map((c, idx) => idx === i ? { ...c, ...updates } : c))
  }

  function removeEntity(i: number) {
    setCharacters(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleCreate() {
    if (!name.trim()) { setError('Nhập tên dự án'); return }
    setCreating(true)
    setError('')
    try {
      const validEntities = characters.filter(c => c.name.trim())
      const project = await postAPI<Project>('/api/projects', {
        name: name.trim(),
        story: story.trim() || undefined,
        material,
        language,
        characters: validEntities.map(c => ({
          name: c.name.trim(),
          description: c.description.trim() || undefined,
          entity_type: c.entity_type,
        })),
      })
      onCreated(project)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message.replace('API 4', 'Lỗi: ').replace('API 5', 'Lỗi server: ') : 'Lỗi tạo dự án')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
    >
      <div
        className="rounded-2xl flex flex-col"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          width: '90%',
          maxWidth: 560,
          maxHeight: '85vh',
        }}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
          <div>
            <div className="flex items-center gap-1.5 font-bold text-sm" style={{ color: 'var(--text)' }}>
              <Sparkles size={13} color="var(--accent)" /> Tạo dự án mới
            </div>
            <div className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              {step === 'info' ? 'Thông tin cơ bản' : 'Nhân vật & Địa điểm'}
            </div>
          </div>
          <button onClick={onCancel} style={{ color: 'var(--muted)', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        {/* Steps indicator */}
        <div className="flex px-6 pt-3 gap-2">
          {(['info', 'entities'] as const).map((s, i) => (
            <div
              key={s}
              className="flex items-center gap-2 text-xs cursor-pointer"
              onClick={() => setStep(s)}
              style={{ color: step === s ? 'var(--accent)' : 'var(--muted)' }}
            >
              <div
                className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-xs"
                style={{
                  background: step === s ? 'var(--accent)' : 'var(--card)',
                  color: step === s ? '#fff' : 'var(--muted)',
                }}
              >
                {i + 1}
              </div>
              {s === 'info' ? 'Thông tin' : 'Nhân vật'}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-6 py-4 flex flex-col gap-4">
          {step === 'info' ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Tên dự án *
                </label>
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="VD: Chiến tranh Việt Nam — Tập 1"
                  style={INPUT_STYLE}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                  Câu chuyện / Tóm tắt kịch bản
                </label>
                <textarea
                  value={story}
                  onChange={e => setStory(e.target.value)}
                  placeholder="Mô tả ngắn gọn nội dung video, bối cảnh, diễn biến..."
                  rows={4}
                  style={{ ...INPUT_STYLE, resize: 'vertical' }}
                />
              </div>

              <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    Visual Style
                  </label>
                  <select
                    value={material}
                    onChange={e => setMaterial(e.target.value)}
                    style={{ ...INPUT_STYLE, cursor: 'pointer' }}
                  >
                    {materials.length > 0 ? materials.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    )) : (
                      <>
                        <option value="realistic">Thực tế</option>
                        <option value="3d_pixar">Hoạt hình 3D</option>
                        <option value="anime">Anime</option>
                        <option value="stop_motion">Stop Motion</option>
                        <option value="oil_painting">Tranh dầu</option>
                      </>
                    )}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    Hướng video
                  </label>
                  <select
                    value={orientation}
                    onChange={e => setOrientation(e.target.value as 'VERTICAL' | 'HORIZONTAL')}
                    style={{ ...INPUT_STYLE, cursor: 'pointer' }}
                  >
                    <option value="VERTICAL">Dọc 9:16 (Shorts)</option>
                    <option value="HORIZONTAL">Ngang 16:9 (YouTube)</option>
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>
                    Ngôn ngữ dự án
                  </label>
                  <select
                    value={language}
                    onChange={e => setLanguage(e.target.value)}
                    style={{ ...INPUT_STYLE, cursor: 'pointer' }}
                  >
                    <option value="vi">Tiếng Việt</option>
                    <option value="en">Tiếng Anh</option>
                    <option value="ja">Tiếng Nhật</option>
                    <option value="ko">Tiếng Hàn</option>
                    <option value="es">Tiếng Tây Ban Nha</option>
                    <option value="fr">Tiếng Pháp</option>
                    <option value="pt">Tiếng Bồ Đào Nha</option>
                  </select>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                Thêm nhân vật, địa điểm, vật thể sẽ xuất hiện trong video. Mỗi thực thể sẽ được tạo ảnh tham chiếu.
              </div>

              <div className="flex flex-col gap-2">
                {characters.map((c, i) => (
                  <div
                    key={i}
                    className="rounded-lg p-3 flex flex-col gap-2"
                    style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center gap-2">
                      <select
                        value={c.entity_type}
                        onChange={e => updateEntity(i, { entity_type: e.target.value as CharacterInput['entity_type'] })}
                        style={{ ...INPUT_STYLE, width: 'auto', cursor: 'pointer', flexShrink: 0 }}
                      >
                        {ENTITY_TYPES.map(({ type, label }) => (
                          <option key={type} value={type}>{label}</option>
                        ))}
                      </select>
                      <input
                        value={c.name}
                        onChange={e => updateEntity(i, { name: e.target.value })}
                        placeholder="Tên *"
                        style={{ ...INPUT_STYLE, flex: 1 }}
                      />
                      <button
                        onClick={() => removeEntity(i)}
                        style={{ color: 'var(--red)', flexShrink: 0, fontSize: 16, lineHeight: 1 }}
                      >
                        ×
                      </button>
                    </div>
                    <textarea
                      value={c.description}
                      onChange={e => updateEntity(i, { description: e.target.value })}
                      placeholder="Mô tả ngoại hình, tính cách (tùy chọn)"
                      rows={2}
                      style={{ ...INPUT_STYLE, resize: 'none', fontSize: 11 }}
                    />
                  </div>
                ))}
              </div>

              {/* Add entity buttons */}
              <div className="flex flex-wrap gap-2">
                {ENTITY_TYPES.map(({ type, label, icon: Icon }) => (
                  <button
                    key={type}
                    onClick={() => addEntity(type)}
                    className="flex items-center gap-1 px-2.5 py-1 rounded text-xs"
                    style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                  >
                    <Plus size={10} /><Icon size={10} /> {label}
                  </button>
                ))}
              </div>
            </>
          )}

          {error && (
            <div className="text-xs px-3 py-2 rounded" style={{
              background: 'rgba(239,68,68,0.1)',
              border: '1px solid rgba(239,68,68,0.3)',
              color: '#ef4444',
            }}>
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          className="px-6 py-4 flex items-center justify-between gap-3"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded text-xs"
            style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
          >
            Hủy
          </button>

          <div className="flex gap-2">
            {step === 'info' ? (
              <button
                onClick={() => setStep('entities')}
                disabled={!name.trim()}
                className="px-4 py-2 rounded text-xs font-bold"
                style={{ background: 'var(--accent)', color: '#fff', opacity: !name.trim() ? 0.5 : 1 }}
              >
                Tiếp theo →
              </button>
            ) : (
              <>
                <button
                  onClick={() => setStep('info')}
                  className="px-3 py-2 rounded text-xs"
                  style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
                >
                  ← Quay lại
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="px-4 py-2 rounded text-xs font-bold"
                  style={{ background: 'var(--accent)', color: '#fff', opacity: creating ? 0.7 : 1 }}
                >
                  {creating
                    ? <><Loader2 size={11} className="spin" /> Đang tạo...</>
                    : <><Sparkles size={11} /> Tạo dự án</>
                  }
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
