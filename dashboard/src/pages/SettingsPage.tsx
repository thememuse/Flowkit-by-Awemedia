import { useState, useEffect } from 'react'
import { fetchAPI, patchAPI, postAPI, deleteAPI } from '../api/client'
import { Key, Bot, Film, Settings2, ClipboardList, Palette, Info, Unlock, Eye, Pencil, Trash2, Settings, AlertTriangle, Package, CheckCircle, XCircle, AudioWaveform, Volume2, FolderOpen } from 'lucide-react'

// ── Types ──────────────────────────────────────────────────
interface Settings {
  // Single key (legacy)
  anthropicApiKey: string
  openaiApiKey: string
  geminiApiKey: string
  sunoApiKey: string
  elevenlabsApiKey: string
  // Key arrays (rotation)
  anthropicApiKeys: string[]
  openaiApiKeys: string[]
  geminiApiKeys: string[]
  // Provider per task
  modelScriptGen: string
  modelEpisodeGen: string
  modelReview: string
  // Model per provider
  claudeModel: string
  openaiModel: string
  geminiModel: string
  // Defaults
  defaultMaterial: string
  defaultOrientation: 'VERTICAL' | 'HORIZONTAL'
  defaultSceneCount: number
  maxConcurrentRequests: number
  apiCooldown: number
  language: string
  reviewModel: string
  upscaleMethod?: 'veo' | 'local_ffmpeg' | 'local_ai'
  downloadLocation?: string
  // TTS defaults
  ttsDefaultModel?: string
  ttsDefaultVoiceId?: string
  ttsDefaultFormat?: string
  ttsStability?: number
  ttsSimilarityBoost?: number
  ttsStyle?: number
  ttsSpeed?: number
  ttsSpeakerBoost?: boolean
}

interface Material {
  id: string
  name: string
  description?: string
  style_instruction?: string
  negative_prompt?: string
  scene_prefix?: string
  lighting?: string
  is_builtin?: boolean
}

interface Skill {
  id: string
  name: string
  content: string
  description?: string
  tags?: string[]
  is_builtin?: boolean
}

// ── Style helpers ─────────────────────────────────────────
const INPUT: React.CSSProperties = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  color: 'var(--text)',
  padding: '6px 10px',
  fontSize: 12,
  outline: 'none',
  width: '100%',
}
const SELECT: React.CSSProperties = { ...INPUT, cursor: 'pointer' }

const DEFAULTS: Settings = {
  anthropicApiKey: '',
  openaiApiKey: '',
  geminiApiKey: '',
  sunoApiKey: '',
  elevenlabsApiKey: '',
  anthropicApiKeys: [],
  openaiApiKeys: [],
  geminiApiKeys: [],
  modelScriptGen: 'claude',
  modelEpisodeGen: 'claude',
  modelReview: 'claude',
  claudeModel: 'claude-haiku-4-5-20251001',
  openaiModel: 'gpt-4o-mini',
  geminiModel: 'gemini-2.0-flash',
  defaultMaterial: 'realistic',
  defaultOrientation: 'VERTICAL',
  defaultSceneCount: 10,
  maxConcurrentRequests: 5,
  apiCooldown: 10,
  language: 'vi',
  reviewModel: 'claude-haiku-4-5-20251001',
  upscaleMethod: 'veo',
  downloadLocation: '',
  ttsDefaultModel: 'eleven_multilingual_v2',
  ttsDefaultVoiceId: '',
  ttsDefaultFormat: 'mp3_44100_128',
  ttsStability: 0.5,
  ttsSimilarityBoost: 0.75,
  ttsStyle: 0.0,
  ttsSpeed: 1.0,
  ttsSpeakerBoost: true,
}

const PROVIDERS = [
  { value: 'claude',  label: 'Claude',  color: '#d97706' },
  { value: 'openai',  label: 'OpenAI',  color: '#16a34a' },
  { value: 'gemini',  label: 'Gemini',  color: '#2563eb' },
]

const CLAUDE_MODELS = [
  { value: 'claude-sonnet-4-6',          label: 'Claude Sonnet 4.6 — Cân bằng & Thông minh nhất' },
  { value: 'claude-opus-4-7',            label: 'Claude Opus 4.7 — Phân tích mạnh mẽ, kịch bản phức tạp' },
  { value: 'claude-haiku-4-5-20251001',  label: 'Claude Haiku 4.5 — Nhanh, siêu rẻ' },
  { value: 'claude-3-5-sonnet-latest',   label: 'Claude 3.5 Sonnet — Ổn định' },
  { value: 'claude-3-5-haiku-latest',    label: 'Claude 3.5 Haiku — Tốc độ cao' },
]

const OPENAI_MODELS = [
  { value: 'gpt-5.5-instant',            label: 'GPT-5.5 Instant — Mặc định, siêu nhanh' },
  { value: 'gpt-5.5',                    label: 'GPT-5.5 Frontier — Cực kỳ thông minh' },
  { value: 'gpt-4o-mini',                label: 'GPT-4o Mini — Giá rẻ, phản hồi nhanh' },
  { value: 'gpt-4o',                     label: 'GPT-4o Legacy — Ổn định và chính xác' },
  { value: 'o1-mini',                    label: 'o1-mini — Tư duy lập luận logic' },
  { value: 'o1',                         label: 'o1 — Lập luận nâng cao' },
]

const GEMINI_MODELS = [
  { value: 'gemini-3.5-flash',           label: 'Gemini 3.5 Flash — Tốc độ ánh sáng, cực kỳ thông minh' },
  { value: 'gemini-3.1-pro',             label: 'Gemini 3.1 Pro — World-model, lý luận đỉnh cao' },
  { value: 'gemini-2.0-flash',           label: 'Gemini 2.0 Flash — Nhanh & Hiệu quả' },
  { value: 'gemini-2.0-flash-lite',      label: 'Gemini 2.0 Flash Lite — Siêu tiết kiệm' },
  { value: 'gemini-1.5-pro',             label: 'Gemini 1.5 Pro — Cửa sổ ngữ cảnh cực lớn' },
]

const MODEL_OPTIONS: Record<string, { value: string; label: string }[]> = {
  claude: CLAUDE_MODELS,
  openai: OPENAI_MODELS,
  gemini: GEMINI_MODELS,
}

const TASKS = [
  { key: 'modelScriptGen',  label: 'Tạo kịch bản dự án (AI Script)' },
  { key: 'modelEpisodeGen', label: 'Tạo tập mới (AI Episode)' },
  { key: 'modelReview',     label: 'Review chất lượng video' },
] as const


// ── FieldRow ───────────────────────────────────────────────
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>{label}</label>
      {children}
      {hint && <div className="text-xs" style={{ color: 'var(--muted)', opacity: 0.7 }}>{hint}</div>}
    </div>
  )
}

// ── Tab button ─────────────────────────────────────────────
function Tab({ active, onClick, icon: Icon, children }: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-all"
      style={{
        background: 'transparent',
        color: active ? 'var(--accent)' : 'var(--muted)',
        borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
        borderRadius: 0,
      }}
    >
      <Icon size={12} />
      {children}
    </button>
  )
}

// ── API Keys tab ───────────────────────────────────────────
// Component thêm/xoá nhiều key — hỗ trợ xoay vòng khi bị rate-limit

type ProviderKey = 'anthropicApiKeys' | 'openaiApiKeys' | 'geminiApiKeys'

interface KeyGroup {
  title: string
  hint: string
  arrKey: ProviderKey
  singleKey: keyof Settings
  placeholder: string
  color: string
  letter: string
}

function MultiKeyInput({
  label, color, keys, onChange, placeholder, showKeys,
}: {
  label: string; color: string; keys: string[]
  onChange: (keys: string[]) => void
  placeholder: string; showKeys: boolean
}) {
  const add = () => onChange([...keys, ''])
  const remove = (i: number) => onChange(keys.filter((_, idx) => idx !== i))
  const set = (i: number, val: string) => onChange(keys.map((k, idx) => idx === i ? val : k))

  return (
    <div className="flex flex-col gap-1.5">
      {keys.map((k, i) => (
        <div key={i} className="flex gap-1.5 items-center group">
          {/* Index badge */}
          <div className="w-5 h-5 rounded flex items-center justify-center text-xs font-bold flex-shrink-0"
            style={{ background: color + '22', color }}>
            {i + 1}
          </div>
          <input
            type={showKeys ? 'text' : 'password'}
            value={k}
            onChange={e => set(i, e.target.value)}
            placeholder={placeholder}
            style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '5px 9px', fontSize: 12, outline: 'none', fontFamily: 'monospace' }}
          />
          {/* Remove button */}
          <button onClick={() => remove(i)}
            className="opacity-0 group-hover:opacity-100 transition-opacity w-6 h-6 rounded flex items-center justify-center flex-shrink-0"
            style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}
            title="Xoá key này">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      ))}
      {/* Add key button */}
      <button onClick={add}
        className="flex items-center gap-1.5 text-xs py-1.5 px-2 rounded transition-all"
        style={{ background: color + '11', color, border: `1px dashed ${color}55`, cursor: 'pointer' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        Thêm key {label}
      </button>
    </div>
  )
}

function APIKeysTab({ settings, update }: { settings: Settings; update: <K extends keyof Settings>(k: K, v: Settings[K]) => void }) {
  const [showKeys, setShowKeys] = useState(false)
  const [keyStatus, setKeyStatus] = useState<Record<string, { total: number; available: number; rate_limited: number }>>({})

  useEffect(() => {
    fetchAPI<Record<string, { total: number; available: number; rate_limited: number }>>('/api/ai/key-status').then(setKeyStatus).catch(() => {})
    const t = setInterval(() => {
      fetchAPI<Record<string, { total: number; available: number; rate_limited: number }>>('/api/ai/key-status').then(setKeyStatus).catch(() => {})
    }, 10000)
    return () => clearInterval(t)
  }, [])

  const keyGroups: KeyGroup[] = [
    { title: 'Anthropic Claude', hint: 'console.anthropic.com', arrKey: 'anthropicApiKeys', singleKey: 'anthropicApiKey', placeholder: 'sk-ant-api03-...', color: '#d97706', letter: 'A' },
    { title: 'OpenAI GPT',       hint: 'platform.openai.com/api-keys', arrKey: 'openaiApiKeys', singleKey: 'openaiApiKey', placeholder: 'sk-proj-...', color: '#16a34a', letter: 'O' },
    { title: 'Google Gemini',    hint: 'aistudio.google.com/app/apikey', arrKey: 'geminiApiKeys', singleKey: 'geminiApiKey', placeholder: 'AIza...', color: '#2563eb', letter: 'G' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="text-xs" style={{ color: 'var(--muted)' }}>
          Thêm nhiều key để tự động xoay vòng khi bị rate-limit
        </div>
        <button
          onClick={() => setShowKeys(!showKeys)}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs"
          style={{ background: 'var(--surface)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          {showKeys ? <><Unlock size={11} /> Ẩn keys</> : <><Eye size={11} /> Hiện keys</>}
        </button>
      </div>

      {/* AI provider key cards */}
      {keyGroups.map(g => {
        const keys = (settings[g.arrKey] as string[]) || []

        // Normalize provider name for status lookup
        const providerName = g.arrKey.replace('ApiKeys', '')  // anthropic, openai, gemini
        const st = keyStatus[providerName] || null

        return (
          <div key={g.arrKey} className="rounded-lg p-4 flex flex-col gap-3"
            style={{ background: 'var(--card)', border: `1px solid ${g.color}33` }}>
            {/* Card header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-sm"
                  style={{ background: g.color + '22', color: g.color }}>
                  {g.letter}
                </div>
                <div>
                  <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{g.title}</div>
                  <div className="text-xs" style={{ color: 'var(--muted)' }}>{g.hint}</div>
                </div>
              </div>
              {/* Status badges */}
              {st && st.total > 0 && (
                <div className="flex gap-1.5 items-center">
                  <span className="badge badge-green">{st.available}/{st.total} sẵn sàng</span>
                  {st.rate_limited > 0 && (
                    <span className="badge badge-yellow">{st.rate_limited} limit</span>
                  )}
                </div>
              )}
            </div>

            {/* Multi-key input */}
            <MultiKeyInput
              label={g.title}
              color={g.color}
              keys={keys.length > 0 ? keys : (settings[g.singleKey] ? [settings[g.singleKey] as string] : [])}
              onChange={newKeys => {
                update(g.arrKey, newKeys)
                // Sync single key (legacy compat — dùng key đầu tiên)
                update(g.singleKey, newKeys[0] ?? '')
              }}
              placeholder={g.placeholder}
              showKeys={showKeys}
            />
          </div>
        )
      })}

      {/* ElevenLabs key — single only */}
      <div className="rounded-lg p-4 flex flex-col gap-2.5"
        style={{ background: 'var(--card)', border: '1px solid rgba(124,91,245,0.33)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-sm"
              style={{ background: 'rgba(124,91,245,0.22)', color: '#a48ef8' }}>E</div>
            <div>
              <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>ElevenLabs TTS</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>elevenlabs.io — text-to-speech AI</div>
            </div>
          </div>
          <button
            onClick={async () => {
              try {
                const r = await fetchAPI<{ok: boolean, message: string}>('/api/elevenlabs/test')
                alert(r.message)
              } catch (e: unknown) {
                const err = e as {message?: string}
                alert('Lỗi: ' + (err?.message || 'Không kết nối được'))
              }
            }}
            className="flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold border"
            style={{ borderColor: 'rgba(124,91,245,0.4)', color: '#a48ef8', background: 'rgba(124,91,245,0.08)' }}
          >
            Test kết nối
          </button>
        </div>
        <input
          type={showKeys ? 'text' : 'password'}
          value={settings.elevenlabsApiKey ?? ''}
          onChange={e => update('elevenlabsApiKey', e.target.value)}
          placeholder="sk_..."
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '5px 9px', fontSize: 12, outline: 'none', width: '100%', fontFamily: 'monospace' }}
        />
      </div>

      {/* Suno key — single only */}
      <div className="rounded-lg p-4 flex flex-col gap-2.5"
        style={{ background: 'var(--card)', border: '1px solid #7c3aed33' }}>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-md flex items-center justify-center font-bold text-sm"
            style={{ background: '#7c3aed22', color: '#7c3aed' }}>♪</div>
          <div>
            <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Suno Music</div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>sunoapi.org — tạo nhạc nền</div>
          </div>
        </div>
        <input
          type={showKeys ? 'text' : 'password'}
          value={settings.sunoApiKey}
          onChange={e => update('sunoApiKey', e.target.value)}
          placeholder="eyJ..."
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '5px 9px', fontSize: 12, outline: 'none', width: '100%', fontFamily: 'monospace' }}
        />
      </div>

      {/* Security tip */}
      <div className="flex items-start gap-2 text-xs p-3 rounded-lg"
        style={{ background: 'rgba(124,91,245,0.08)', border: '1px solid rgba(124,91,245,0.15)', color: 'var(--muted)' }}>
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
        <span>
          <strong style={{ color: 'var(--accent)' }}>Key rotation:</strong> Khi một key bị rate-limit (429),
          hệ thống tự động chuyển sang key tiếp theo. Key bị limit sẽ hồi phục sau 60 giây.
          Tất cả keys lưu cục bộ, không gửi lên server ngoài API chính thức.
        </span>
      </div>
    </div>
  )
}

// ── Models per Task tab ──────────────────────────────────────
function ModelsTab({ settings, update }: { settings: Settings; update: <K extends keyof Settings>(k: K, v: Settings[K]) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="text-xs" style={{ color: 'var(--muted)' }}>
        Chọn AI provider và model cho từng tác vụ. Mỗi tác vụ có thể dùng provider khác nhau.
      </div>

      {TASKS.map(task => {
        const taskKey = task.key as keyof Settings
        const currentProvider = String(settings[taskKey] || 'claude')
        const modelKey = `${currentProvider}Model` as keyof Settings
        const modelList = MODEL_OPTIONS[currentProvider] || CLAUDE_MODELS
        const providerInfo = PROVIDERS.find(p => p.value === currentProvider)
        const color = providerInfo?.color || 'var(--accent)'

        return (
          <div key={task.key} className="rounded-xl p-4 flex flex-col gap-3"
            style={{ background: 'var(--card)', border: `1px solid ${color}33` }}>
            <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{task.label}</div>

            <div className="flex gap-2">
              {PROVIDERS.map(p => (
                <button
                  key={p.value}
                  onClick={() => update(taskKey, p.value as Settings[typeof taskKey])}
                  className="flex-1 py-1.5 rounded-md text-xs font-medium transition-all"
                  style={{
                    background: currentProvider === p.value ? p.color + '22' : 'var(--surface)',
                    color: currentProvider === p.value ? p.color : 'var(--muted)',
                    border: `1px solid ${currentProvider === p.value ? p.color + '66' : 'var(--border)'}`,
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs flex-shrink-0" style={{ color: 'var(--muted)' }}>Model:</span>
              <select
                value={String(settings[modelKey] ?? modelList[0]?.value)}
                onChange={e => update(modelKey, e.target.value as Settings[typeof modelKey])}
                style={{ flex: 1, background: 'var(--surface)', border: `1px solid ${color}44`, borderRadius: 6, color: 'var(--text)', padding: '5px 8px', fontSize: 12, outline: 'none', cursor: 'pointer' }}
              >
                {modelList.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
            </div>

            {task.key === 'modelReview' && currentProvider !== 'claude' && (
              <div className="text-xs px-3 py-2 rounded flex items-center gap-1.5" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: 'var(--yellow)' }}>
                <AlertTriangle size={11} /> Review Vision hiện chỉ hỗ trợ Claude. Đổi lại Claude để sử dụng tính năng này.
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}



// ── Project Defaults tab ───────────────────────────────────
function DefaultsTab({ settings, update, materials }: {
  settings: Settings
  update: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  materials: Material[]
}) {
  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1.5 font-bold text-sm" style={{ color: 'var(--text)' }}><Film size={13} color="var(--accent)" /> Mặc định dự án</div>

        <div className="grid gap-4" style={{ gridTemplateColumns: '1fr 1fr' }}>
          <Field label="Visual Style (Material)">
            <select value={settings.defaultMaterial} onChange={e => update('defaultMaterial', e.target.value)} style={SELECT}>
              {materials.length > 0 ? materials.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              )) : (
                <>
                  <option value="realistic">Thực tế (Realistic)</option>
                  <option value="3d_pixar">Hoạt hình 3D (Pixar)</option>
                  <option value="anime">Anime</option>
                  <option value="stop_motion">Stop Motion</option>
                  <option value="oil_painting">Tranh dầu</option>
                  <option value="minecraft">Minecraft</option>
                </>
              )}
            </select>
          </Field>

          <Field label="Hướng video">
            <select value={settings.defaultOrientation} onChange={e => update('defaultOrientation', e.target.value as 'VERTICAL' | 'HORIZONTAL')} style={SELECT}>
              <option value="VERTICAL">Dọc (9:16 — YouTube Shorts)</option>
              <option value="HORIZONTAL">Ngang (16:9 — YouTube)</option>
            </select>
          </Field>

          <Field label="Số cảnh mặc định" hint="Số cảnh tự động tạo khi tạo video mới">
            <input
              type="number" min={1} max={60}
              value={settings.defaultSceneCount}
              onChange={e => update('defaultSceneCount', Number(e.target.value))}
              style={INPUT}
            />
          </Field>

          <Field label="Ngôn ngữ mặc định">
            <select value={settings.language} onChange={e => update('language', e.target.value)} style={SELECT}>
              <option value="vi">Tiếng Việt</option>
              <option value="en">Tiếng Anh</option>
              <option value="ja">Tiếng Nhật</option>
              <option value="ko">Tiếng Hàn</option>
              <option value="es">Tiếng Tây Ban Nha</option>
              <option value="fr">Tiếng Pháp</option>
              <option value="pt">Tiếng Bồ Đào Nha</option>
              <option value="zh">Tiếng Trung</option>
            </select>
          </Field>
        </div>
      </div>

      <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1.5 font-bold text-sm" style={{ color: 'var(--text)' }}><Settings2 size={13} color="var(--accent)" /> Pipeline</div>
        <div className="text-xs p-3 rounded-lg" style={{ background: 'rgba(124,91,245,0.08)', border: '1px solid rgba(124,91,245,0.2)', color: 'var(--muted)' }}>
          Thay đổi có hiệu lực ngay, không cần khởi động lại. Khuyến nghị: <strong style={{ color: 'var(--accent)' }}>3 concurrent</strong> để an toàn. Tối đa 5 (giới hạn Flow API). Cao hơn 5 có thể bị captcha.
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          <Field label="Phương thức Upscale" hint="Cloud tốn credit hoặc Offline miễn phí">
            <select value={settings.upscaleMethod || 'veo'} onChange={e => update('upscaleMethod', e.target.value as 'veo' | 'local_ffmpeg' | 'local_ai')} style={SELECT}>
              <option value="veo">Google Veo (Cloud - Tốn credit)</option>
              <option value="local_ai">Local AI (Real-ESRGAN - Offline)</option>
              <option value="local_ffmpeg">Local Fast (Lanczos - Offline)</option>
            </select>
          </Field>
          <Field label="Concurrent requests" hint="Số video/ảnh tạo song song (3=an toàn, 5=tối đa)">
            <input type="number" min={1} max={5} value={settings.maxConcurrentRequests} onChange={e => update('maxConcurrentRequests', Number(e.target.value))} style={INPUT} />
          </Field>
          <Field label="API cooldown (giây)" hint="Thời gian nghỉ giữa các API call (10s mặc định)">
            <input type="number" min={0} max={60} value={settings.apiCooldown} onChange={e => update('apiCooldown', Number(e.target.value))} style={INPUT} />
          </Field>
        </div>

        {/* Thư mục lưu trữ dự án (Download Location) */}
        <div className="mt-4 pt-4 border-t border-dashed" style={{ borderColor: 'var(--border)' }}>
          <Field label="Thư mục lưu trữ dự án (Download Location)" hint="Mọi hình ảnh, video và âm nhạc của dự án sẽ được tự động tải và lưu về thư mục này. Để trống = ~/Downloads/flowkit mặc định.">
            <div className="flex gap-2 mt-1">
              <input
                type="text"
                value={settings.downloadLocation ?? ''}
                onChange={e => update('downloadLocation', e.target.value)}
                placeholder="Ví dụ: /Users/username/Movies/Flowkit-Studio"
                style={{ ...INPUT, fontFamily: 'monospace' }}
              />
              {typeof window !== 'undefined' && (window as any).electronAPI && (
                <button
                  type="button"
                  onClick={async () => {
                    const electronAPI = (window as any).electronAPI
                    try {
                      const res = await electronAPI.showOpenDialog({
                        properties: ['openDirectory', 'createDirectory']
                      })
                      if (res && !res.canceled && res.filePaths && res.filePaths.length > 0) {
                        update('downloadLocation', res.filePaths[0])
                      }
                    } catch (err) {
                      console.error('Failed to open folder dialog:', err)
                    }
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border flex items-center gap-1.5 transition-all active:scale-95 flex-shrink-0 cursor-pointer"
                  style={{ borderColor: 'var(--accent)', color: '#a48ef8', background: 'rgba(124,91,245,0.08)' }}
                >
                  <FolderOpen size={13} /> Duyệt...
                </button>
              )}
            </div>
          </Field>
        </div>
      </div>
    </div>
  )
}

// ── Skills tab ─────────────────────────────────────────────
function SkillsTab({ skills, onAdd, onEdit, onDelete }: {
  skills: Skill[]
  onAdd: () => void
  onEdit: (s: Skill) => void
  onDelete: (id: string) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = skills.filter(s =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.description || '').toLowerCase().includes(search.toLowerCase())
  )
  const builtin = filtered.filter(s => s.is_builtin)
  const custom = filtered.filter(s => !s.is_builtin)

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Tìm kiếm skill..."
          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 12, outline: 'none' }}
        />
        <button onClick={onAdd} className="btn btn-primary" style={{ fontSize: 12, padding: '6px 12px', flexShrink: 0 }}>
          + Thêm Skill
        </button>
      </div>

      {/* Stats */}
      <div className="flex gap-3 text-xs" style={{ color: 'var(--muted)' }}>
        <span className="flex items-center gap-1"><Package size={10} /> {skills.filter(s => s.is_builtin).length} built-in</span>
        <span>•</span>
        <span className="flex items-center gap-1"><Pencil size={10} /> {skills.filter(s => !s.is_builtin).length} tùy chỉnh</span>
        {search && <span>• Hiện {filtered.length} kết quả</span>}
      </div>

      {/* Custom skills first */}
      {custom.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-bold uppercase" style={{ color: 'var(--accent)', letterSpacing: 1 }}>Tùy chỉnh</div>
          {custom.map(s => (
            <div key={s.id} className="rounded-lg p-3 flex items-start justify-between gap-3"
              style={{ background: 'rgba(124,91,245,0.08)', border: '1px solid rgba(124,91,245,0.2)' }}>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>{s.name}</div>
                {s.description && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--muted)' }}>{s.description}</p>}
                {s.tags && s.tags.length > 0 && (
                  <div className="flex gap-1 mt-1">{s.tags.map(t => <span key={t} className="badge badge-purple">{t}</span>)}</div>
                )}
              </div>
              <div className="flex gap-1 flex-shrink-0">
                <button onClick={() => onEdit(s)} className="btn btn-ghost" style={{ padding: '4px 8px' }} title="Sửa"><Pencil size={12} /></button>
                <button onClick={() => onDelete(s.id)} className="btn btn-danger" style={{ padding: '4px 8px' }} title="Xóa"><Trash2 size={12} /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Builtin skills */}
      {builtin.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-bold uppercase" style={{ color: 'var(--muted)', letterSpacing: 1 }}>Built-in ({builtin.length})</div>
          {builtin.map(s => (
            <div key={s.id} className="rounded-lg p-3 flex items-start justify-between gap-3"
              style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>{s.name}</span>
                  <span className="badge badge-blue">built-in</span>
                </div>
                {s.description && <p className="text-xs truncate" style={{ color: 'var(--muted)' }}>{s.description}</p>}
                {s.tags && s.tags.length > 0 && (
                  <div className="flex gap-1 mt-1">{s.tags.map(t => <span key={t} className="badge badge-purple">{t}</span>)}</div>
                )}
              </div>
              <button onClick={() => onEdit(s)} className="btn btn-ghost" style={{ padding: '4px 8px', flexShrink: 0 }} title="Xem">
                <Eye size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="text-center py-8 text-xs" style={{ color: 'var(--muted)' }}>Không tìm thấy skill nào.</div>
      )}
    </div>
  )
}

// ── Styles tab ─────────────────────────────────────────────
function StylesTab({ settings, update, materials, onMaterialAdded, onMaterialDeleted }: {
  settings: Settings
  update: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  materials: Material[]
  onMaterialAdded: (m: Material) => void
  onMaterialDeleted: (id: string) => void
}) {
  const [showAddForm, setShowAddForm] = useState(false)
  const [form, setForm] = useState({ id: '', name: '', style_instruction: '', negative_prompt: '', scene_prefix: '', lighting: '' })
  const [adding, setAdding] = useState(false)
  const [formError, setFormError] = useState('')

  const handleAdd = async () => {
    if (!form.id.trim() || !form.name.trim() || !form.style_instruction.trim()) {
      setFormError('ID, tên và style instruction là bắt buộc')
      return
    }
    setAdding(true)
    setFormError('')
    try {
      const result = await postAPI<Material>('/api/materials', { ...form })
      onMaterialAdded(result)
      setForm({ id: '', name: '', style_instruction: '', negative_prompt: '', scene_prefix: '', lighting: '' })
      setShowAddForm(false)
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message.replace(/^API \d+: /, '') : String(e))
    } finally {
      setAdding(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(`Xóa style "${id}"?`)) return
    try {
      await deleteAPI(`/api/materials/${id}`)
      onMaterialDeleted(id)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e))
    }
  }

  // Use Palette icon for all materials – clean, consistent
  const STYLE_ICONS: Record<string, string> = {
    realistic: 'R', '3d_pixar': '3D', anime: 'AN', stop_motion: 'SM',
    minecraft: 'MC', oil_painting: 'OP', ghibli: 'GB', watercolor: 'WC',
    comic_book: 'CB', cyberpunk: 'CP', claymation: 'CL', lego: 'LG', retro_vhs: 'VH',
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Material Grid */}
      <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 font-bold text-sm" style={{ color: 'var(--text)' }}>
            <Palette size={13} color="var(--accent)" /> Phong cách hình ảnh
          </div>
          <button
            onClick={() => setShowAddForm(v => !v)}
            className="text-xs px-3 py-1.5 rounded-lg font-medium"
            style={{ background: 'rgba(124,91,245,0.12)', color: 'var(--accent)', border: '1px solid rgba(124,91,245,0.25)' }}
          >
            {showAddForm ? '× Đóng' : '+ Thêm style'}
          </button>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="rounded-lg p-4 flex flex-col gap-3" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="text-xs font-bold" style={{ color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Thêm style mới</div>
            <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="flex flex-col gap-1">
                <label className="text-xs" style={{ color: 'var(--muted)' }}>ID (không dấu, gạch_dưới) *</label>
                <input value={form.id} onChange={e => setForm(f => ({ ...f, id: e.target.value.toLowerCase().replace(/\s/g, '_') }))} placeholder="my_style" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 9px', fontSize: 12, outline: 'none' }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs" style={{ color: 'var(--muted)' }}>Tên hiển thị *</label>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="My Style" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 9px', fontSize: 12, outline: 'none' }} />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--muted)' }}>Style Instruction (mô tả phong cách hình ảnh) *</label>
              <textarea value={form.style_instruction} onChange={e => setForm(f => ({ ...f, style_instruction: e.target.value }))} rows={3} placeholder="Photorealistic style, highly detailed..." style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 9px', fontSize: 12, outline: 'none', resize: 'vertical' }} />
            </div>
            <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="flex flex-col gap-1">
                <label className="text-xs" style={{ color: 'var(--muted)' }}>Negative prompt</label>
                <input value={form.negative_prompt} onChange={e => setForm(f => ({ ...f, negative_prompt: e.target.value }))} placeholder="NOT anime, NOT cartoon..." style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 9px', fontSize: 12, outline: 'none' }} />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs" style={{ color: 'var(--muted)' }}>Lighting</label>
                <input value={form.lighting} onChange={e => setForm(f => ({ ...f, lighting: e.target.value }))} placeholder="Studio lighting, highly detailed" style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text)', padding: '5px 9px', fontSize: 12, outline: 'none' }} />
              </div>
            </div>
            {formError && <div className="text-xs flex items-center gap-1" style={{ color: 'var(--red)' }}><AlertTriangle size={10} /> {formError}</div>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowAddForm(false); setFormError('') }} className="btn btn-ghost" style={{ fontSize: 12 }}>Hủy</button>
              <button onClick={handleAdd} disabled={adding} className="btn btn-primary" style={{ fontSize: 12 }}>
                {adding ? 'Đang thêm...' : '+ Thêm style'}
              </button>
            </div>
          </div>
        )}

        {/* Materials grid */}
        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {materials.map(m => (
            <div
              key={m.id}
              className="rounded-lg p-3 flex flex-col gap-1 relative group cursor-pointer transition-all"
              style={{
                background: settings.defaultMaterial === m.id ? 'rgba(124,91,245,0.15)' : 'var(--surface)',
                border: `1px solid ${settings.defaultMaterial === m.id ? 'var(--accent)' : 'var(--border)'}`,
              }}
              onClick={() => update('defaultMaterial', m.id)}
            >
              <div className="flex items-center justify-between">
                <span
                  className="text-xs font-bold px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(124,91,245,0.12)', color: 'var(--accent)', fontFamily: 'monospace' }}
                >
                  {STYLE_ICONS[m.id] ?? <Palette size={12} />}
                </span>
                {!m.is_builtin && (
                  <button
                    onClick={e => { e.stopPropagation(); handleDelete(m.id) }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded flex items-center justify-center"
                    style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--red)', flexShrink: 0 }}
                    title="Xóa style"
                  >
                    <Trash2 size={10} />
                  </button>
                )}
              </div>
              <div className="text-xs font-semibold" style={{ color: settings.defaultMaterial === m.id ? 'var(--accent)' : 'var(--text)' }}>{m.name}</div>
              {settings.defaultMaterial === m.id && (
                <div className="text-xs" style={{ color: 'var(--accent)', opacity: 0.7 }}>✓ Mặc định</div>
              )}
              {!m.is_builtin && (
                <div className="text-xs" style={{ color: 'var(--muted)', opacity: 0.6 }}>tùy chỉnh</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Video format */}
      <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1.5 font-bold text-sm" style={{ color: 'var(--text)' }}><Film size={13} color="var(--accent)" /> Định dạng video mặc định</div>
        <div className="grid gap-3" style={{ gridTemplateColumns: '1fr 1fr' }}>
          {[
            { value: 'VERTICAL', label: 'Dọc (9:16)', desc: 'YouTube Shorts, TikTok, Reels' },
            { value: 'HORIZONTAL', label: 'Ngang (16:9)', desc: 'YouTube, Vimeo' },
          ].map(o => (
            <button key={o.value} onClick={() => update('defaultOrientation', o.value as 'VERTICAL' | 'HORIZONTAL')}
              className="rounded-lg p-3 text-left transition-all"
              style={{
                background: settings.defaultOrientation === o.value ? 'rgba(124,91,245,0.15)' : 'var(--surface)',
                border: `1px solid ${settings.defaultOrientation === o.value ? 'var(--accent)' : 'var(--border)'}`,
                cursor: 'pointer',
              }}>
              <div className="text-xs font-semibold mb-0.5" style={{ color: settings.defaultOrientation === o.value ? 'var(--accent)' : 'var(--text)' }}>{o.label}</div>
              <div className="text-xs" style={{ color: 'var(--muted)' }}>{o.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Info tab ───────────────────────────────────────────────
function InfoTab() {
  const [license, setLicense] = useState<{ active: boolean; key?: string; expiresAt?: string; durationType?: string; machineId?: string } | null>(null)
  const [version, setVersion] = useState<string>('1.3.0')

  useEffect(() => {
    fetchAPI<{ version: string }>('/health')
      .then(res => {
        if (res.version) setVersion(res.version)
      })
      .catch(() => {})

    const electronAPI = (window as any).electronAPI
    if (electronAPI) {
      electronAPI.getLicenseStatus().then((status: any) => {
        setLicense(status)
      }).catch(() => {})
    } else {
      // Mock for web preview
      setLicense({
        active: true,
        key: 'FK-PREVIEW-MODE-ONLY',
        durationType: 'TRIAL',
        expiresAt: '2026-12-31 23:59:59',
        machineId: 'web-browser-preview-hardware-id'
      })
    }
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {/* ── Flowkit info ── */}
      <div className="rounded-xl p-5 flex flex-col gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1.5 font-bold text-sm" style={{ color: 'var(--text)' }}><Info size={13} color="var(--accent)" /> Flow Kit</div>
        <div className="text-xs flex flex-col gap-1" style={{ color: 'var(--muted)' }}>
          <div>Phiên bản: <span style={{ color: 'var(--text)' }}>{version}</span></div>
          <div>Backend: <span style={{ color: 'var(--green)' }}>FastAPI + Python</span></div>
          <div>Frontend: <span style={{ color: 'var(--accent)' }}>React + Vite + Electron</span></div>
          <div>AI: <span style={{ color: 'var(--text)' }}>Claude / OpenAI / Gemini</span></div>
        </div>
      </div>

      {/* ── License Info ── */}
      <div className="rounded-xl p-5 flex flex-col gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1.5 font-bold text-sm" style={{ color: 'var(--text)' }}>
          <Package size={13} color="var(--accent)" /> Thông tin Bản quyền (License Info)
        </div>
        {license ? (
          <div className="text-xs flex flex-col gap-2" style={{ color: 'var(--muted)' }}>
            <div className="flex items-center gap-2">
              Trạng thái: 
              {license.active ? (
                <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-400 border border-green-500/20 font-bold text-[10px]">ĐÃ KÍCH HOẠT (ACTIVE)</span>
              ) : (
                <span className="px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 border border-red-500/20 font-bold text-[10px]">CHƯA KÍCH HOẠT (INACTIVE)</span>
              )}
            </div>
            {license.key && (
              <div>Mã kích hoạt: <code className="px-1.5 py-0.5 rounded font-mono text-white" style={{ background: 'var(--surface)' }}>{license.key}</code></div>
            )}
            {license.durationType && (
              <div>Gói đăng ký: <span className="font-semibold text-white">{license.durationType === 'TRIAL' ? 'Dùng thử (TRIAL)' : license.durationType === '1_MONTH' ? '1 Tháng' : license.durationType === '6_MONTHS' ? '6 Tháng' : '1 Năm'}</span></div>
            )}
            {license.expiresAt && (
              <div>Hạn sử dụng: <span className="font-mono text-white">{license.expiresAt.substring(0, 10)}</span></div>
            )}
            {license.machineId && (
              <div className="flex items-center gap-1.5">
                Machine ID: 
                <span className="font-mono text-purple-400 select-all cursor-pointer truncate max-w-[240px]" title={license.machineId}>{license.machineId}</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(license.machineId || '')
                    alert('Đã copy Machine ID vào clipboard!')
                  }}
                  className="px-1.5 py-0.5 rounded text-[10px] bg-white/5 border border-white/10 hover:border-purple-500/20 text-slate-400 hover:text-purple-400 transition-all active:scale-95"
                >
                  Copy
                </button>
              </div>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-500 italic">Đang tải trạng thái bản quyền...</div>
        )}
      </div>

      {/* ── App Paths ── */}
      <div className="rounded-xl p-5 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-1.5 font-bold text-sm" style={{ color: 'var(--text)' }}><Settings size={13} color="var(--accent)" /> Đường dẫn dữ liệu</div>
        <div className="text-xs" style={{ color: 'var(--muted)' }}>Database, settings và dữ liệu app được lưu tại:</div>
        <code className="text-xs p-2 rounded" style={{ background: 'var(--surface)', color: 'var(--accent)' }}>~/Library/Application Support/flowkit/</code>
      </div>
    </div>
  )
}


// ── TTS Defaults Tab ───────────────────────────────────────
const TTS_MODELS = [
  { id: 'eleven_multilingual_v2', label: 'Multilingual v2', desc: 'Chất lượng cao, 29 ngôn ngữ' },
  { id: 'eleven_v3',              label: 'Eleven v3 ✨',    desc: 'Flagship, 70+ ngôn ngữ, 5k ký tự/lần' },
  { id: 'eleven_flash_v2_5',      label: 'Flash v2.5 ⚡',  desc: 'Độ trễ siêu thấp ~75ms' },
  { id: 'eleven_turbo_v2_5',      label: 'Turbo v2.5',     desc: 'Cân bằng chất lượng / tốc độ' },
]

const TTS_FORMATS = [
  { value: 'mp3_44100_128', label: 'MP3 44.1kHz · 128kbps (Mặc định)' },
  { value: 'mp3_44100_192', label: 'MP3 44.1kHz · 192kbps (Chất lượng cao)' },
  { value: 'mp3_44100_96',  label: 'MP3 44.1kHz · 96kbps' },
  { value: 'mp3_44100_64',  label: 'MP3 44.1kHz · 64kbps (Nhẹ)' },
  { value: 'mp3_22050_32',  label: 'MP3 22kHz · 32kbps (Nhỏ nhất)' },
  { value: 'pcm_44100',     label: 'PCM 44.1kHz (Không nén)' },
  { value: 'pcm_24000',     label: 'PCM 24kHz' },
  { value: 'pcm_16000',     label: 'PCM 16kHz' },
]

function SliderSetting({ label, hint, value, min, max, step, fmt, onChange }: {
  label: string; hint?: string; value: number
  min: number; max: number; step: number
  fmt?: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>{label}</div>
          {hint && <div className="text-[10px]" style={{ color: 'var(--muted)' }}>{hint}</div>}
        </div>
        <span className="text-xs font-mono px-2 py-0.5 rounded tabular-nums"
          style={{ background: 'var(--accent)15', color: 'var(--accent)', minWidth: 48, textAlign: 'center' }}>
          {fmt ? fmt(value) : value.toFixed(2)}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: 'var(--accent)' }} />
    </div>
  )
}

function TTSDefaultsTab({ settings, update }: {
  settings: Settings
  update: <K extends keyof Settings>(k: K, v: Settings[K]) => void
}) {
  return (
    <div className="flex flex-col gap-5 max-w-2xl">

      {/* Info banner */}
      <div className="rounded-xl p-4 flex items-start gap-3"
        style={{ background: 'rgba(124,91,245,0.07)', border: '1px solid rgba(124,91,245,0.2)' }}>
        <AudioWaveform size={16} style={{ color: '#a48ef8', flexShrink: 0, marginTop: 1 }} />
        <div>
          <div className="text-xs font-semibold" style={{ color: '#a48ef8' }}>ElevenLabs TTS — Cài đặt mặc định</div>
          <div className="text-[11px] mt-1" style={{ color: 'var(--muted)' }}>
            Các giá trị này sẽ được áp dụng tự động khi mở TTS Studio. Bạn vẫn có thể chỉnh sửa trực tiếp trong studio.
          </div>
        </div>
      </div>

      {/* Model mặc định */}
      <div className="rounded-xl p-5 flex flex-col gap-4" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text)' }}>
          <Volume2 size={13} color="var(--accent)" /> Model mặc định
        </div>
        <div className="grid gap-2">
          {TTS_MODELS.map(m => (
            <button key={m.id} onClick={() => update('ttsDefaultModel', m.id)}
              className="flex items-center gap-3 px-4 py-2.5 rounded-lg text-left border transition-all w-full"
              style={{
                background:  settings.ttsDefaultModel === m.id ? 'rgba(124,91,245,0.08)' : 'transparent',
                borderColor: settings.ttsDefaultModel === m.id ? 'rgba(124,91,245,0.3)'  : 'var(--border)',
              }}>
              <div className="w-4 h-4 rounded-full border-2 flex-shrink-0 transition-all"
                style={{
                  borderColor: settings.ttsDefaultModel === m.id ? 'var(--accent)' : 'var(--border)',
                  background:  settings.ttsDefaultModel === m.id ? 'var(--accent)' : 'transparent',
                }} />
              <div>
                <div className="text-xs font-semibold" style={{ color: settings.ttsDefaultModel === m.id ? 'var(--accent)' : 'var(--text)' }}>
                  {m.label}
                </div>
                <div className="text-[10px]" style={{ color: 'var(--muted)' }}>{m.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Voice ID mặc định */}
      <div className="rounded-xl p-5 flex flex-col gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text)' }}>
          <Volume2 size={13} color="var(--accent)" /> Voice ID mặc định
        </div>
        <div className="text-[11px]" style={{ color: 'var(--muted)' }}>
          Nhập Voice ID từ ElevenLabs (tìm trong Library → Voices → Details). Để trống = chọn giọng đầu tiên.
        </div>
        <input
          value={settings.ttsDefaultVoiceId ?? ''}
          onChange={e => update('ttsDefaultVoiceId', e.target.value)}
          placeholder="Ví dụ: 21m00Tcm4TlvDq8ikWAM"
          style={INPUT}
        />
      </div>

      {/* Output format */}
      <div className="rounded-xl p-5 flex flex-col gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text)' }}>
          <Settings size={13} color="var(--accent)" /> Định dạng xuất mặc định
        </div>
        <select
          value={settings.ttsDefaultFormat ?? 'mp3_44100_128'}
          onChange={e => update('ttsDefaultFormat', e.target.value)}
          style={SELECT}
        >
          {TTS_FORMATS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
        </select>
      </div>

      {/* Voice Settings sliders */}
      <div className="rounded-xl p-5 flex flex-col gap-5" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 text-sm font-bold" style={{ color: 'var(--text)' }}>
          <Settings2 size={13} color="var(--accent)" /> Thông số giọng mặc định
        </div>

        <SliderSetting
          label="Stability"
          hint="Thấp = nhiều cảm xúc · Cao = ổn định"
          value={settings.ttsStability ?? 0.5}
          min={0} max={1} step={0.01}
          onChange={v => update('ttsStability', v)}
        />
        <SliderSetting
          label="Similarity Boost"
          hint="Cao = sát giọng gốc (có thể khuếch đại nhiễu)"
          value={settings.ttsSimilarityBoost ?? 0.75}
          min={0} max={1} step={0.01}
          onChange={v => update('ttsSimilarityBoost', v)}
        />
        <SliderSetting
          label="Style"
          hint="Phong cách nói — chỉ hiệu quả với v2/v3"
          value={settings.ttsStyle ?? 0.0}
          min={0} max={1} step={0.01}
          onChange={v => update('ttsStyle', v)}
        />
        <SliderSetting
          label="Tốc độ đọc"
          hint="1.0 = bình thường · 0.25× – 4.0×"
          value={settings.ttsSpeed ?? 1.0}
          min={0.25} max={4.0} step={0.05}
          fmt={v => `${v.toFixed(2)}×`}
          onChange={v => update('ttsSpeed', v)}
        />

        {/* Speaker Boost toggle */}
        <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <div>
            <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Speaker Boost</div>
            <div className="text-[10px]" style={{ color: 'var(--muted)' }}>Tăng độ rõ và tương đồng với giọng gốc</div>
          </div>
          <button
            onClick={() => update('ttsSpeakerBoost', !(settings.ttsSpeakerBoost ?? true))}
            className="w-10 h-6 rounded-full relative flex-shrink-0 transition-all"
            style={{
              background: (settings.ttsSpeakerBoost ?? true) ? 'var(--accent)' : 'var(--surface)',
              border: '1px solid var(--border)'
            }}>
            <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all"
              style={{ left: (settings.ttsSpeakerBoost ?? true) ? '1.25rem' : '2px' }} />
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Skill modal ────────────────────────────────────────────
function SkillModal({ skill, onSave, onClose }: {
  skill: Partial<Skill> | null
  onSave: (data: Partial<Skill>) => Promise<void>
  onClose: () => void
}) {
  const [form, setForm] = useState<Partial<Skill>>(skill ?? { name: '', content: '', description: '' })
  const [saving, setSaving] = useState(false)

  const handle = async () => {
    if (!form.name || !form.content) return
    setSaving(true)
    await onSave(form)
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="rounded-xl p-6 flex flex-col gap-4 w-full max-w-lg" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>{skill?.id ? 'Sửa Skill' : 'Thêm Skill'}</div>

        <Field label="Tên skill">
          <input value={form.name ?? ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} style={INPUT} placeholder="Tên skill..." />
        </Field>
        <Field label="Mô tả (tùy chọn)">
          <input value={form.description ?? ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={INPUT} placeholder="Mô tả ngắn..." />
        </Field>
        <Field label="Nội dung (Markdown)">
          <textarea value={form.content ?? ''} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} rows={8}
            style={{ ...INPUT, fontFamily: 'monospace', fontSize: 11, resize: 'vertical' }} placeholder="# Skill name&#10;&#10;Instructions..." />
        </Field>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="btn btn-secondary">Huỷ</button>
          <button onClick={handle} disabled={saving || !form.name || !form.content} className="btn btn-primary">
            {saving ? 'Đang lưu...' : 'Lưu'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main SettingsPage ──────────────────────────────────────
type SettingsTabKey = 'keys' | 'models' | 'defaults' | 'tts' | 'skills' | 'styles' | 'info'

const SETTINGS_TABS: { key: SettingsTabKey; label: string; icon: React.ElementType }[] = [
  { key: 'keys',     label: 'API Keys',  icon: Key },
  { key: 'models',   label: 'AI Models', icon: Bot },
  { key: 'defaults', label: 'Mặc định',  icon: Settings2 },
  { key: 'tts',      label: 'TTS',       icon: AudioWaveform },
  { key: 'skills',   label: 'Skills',    icon: ClipboardList },
  { key: 'styles',   label: 'Styles',    icon: Palette },
  { key: 'info',     label: 'Thông tin', icon: Info },
]

export default function SettingsPage() {
  const [tab, setTab] = useState<SettingsTabKey>('keys')
  const [settings, setSettings] = useState<Settings>(DEFAULTS)
  const [materials, setMaterials] = useState<Material[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; msg: string } | null>(null)
  const [skillModal, setSkillModal] = useState<{ skill: Partial<Skill> | null; open: boolean }>({ skill: null, open: false })

  useEffect(() => {
    fetchAPI('/api/settings').then((d: unknown) => setSettings({ ...DEFAULTS, ...(d as Settings) })).catch(console.error)
    fetchAPI('/api/materials').then((d: unknown) => setMaterials(d as Material[])).catch(console.error)
    fetchAPI('/api/skills').then((d: unknown) => setSkills(d as Skill[])).catch(console.error)
  }, [])

  const update = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    setSettings(s => ({ ...s, [k]: v }))
    setSaved(false)
  }

  const save = async () => {
    setSaving(true)
    try {
      await patchAPI('/api/settings', settings as unknown as Record<string, unknown>)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      setToast({ type: 'success', msg: 'Cài đặt đã được lưu thành công!' })
      setTimeout(() => setToast(null), 3000)
    } catch (e: unknown) {
      const raw = e instanceof Error ? e.message : String(e)
      setToast({ type: 'error', msg: `Lưu thất bại: ${raw.replace(/^API \d+: /, '')}` })
      setTimeout(() => setToast(null), 5000)
    } finally {
      setSaving(false)
    }
  }

  const reset = () => setSettings(DEFAULTS)

  const saveSkill = async (data: Partial<Skill>) => {
    if (data.id) {
      await patchAPI(`/api/skills/${data.id}`, data)
    } else {
      await postAPI('/api/skills', data)
    }
    const updated = await fetchAPI('/api/skills') as Skill[]
    setSkills(updated)
    setSkillModal({ skill: null, open: false })
  }

  const deleteSkill = async (id: string) => {
    if (!confirm('Xóa skill này?')) return
    await fetchAPI(`/api/skills/${id}`, { method: 'DELETE' }).catch(() => {})
    setSkills(s => s.filter(x => x.id !== id))
  }

  return (
    <div className="flex flex-col h-full" style={{ background: 'var(--bg)' }}>
      {/* Header */}
      <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
        <div>
          <h1 className="font-bold text-base" style={{ color: 'var(--text)' }}>Cài đặt</h1>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>API keys, pipeline, skills và phong cách hình ảnh</p>
        </div>
        <div className="flex gap-2">
          <button onClick={reset} className="btn btn-ghost">Đặt lại</button>
          <button onClick={save} disabled={saving} className="btn btn-primary"
            style={{ minWidth: 80, transition: 'all 0.2s', background: saved ? 'var(--green)' : undefined }}>
            {saving ? '⏳ Đang lưu...' : saved ? '✓ Đã lưu' : 'Lưu cài đặt'}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 px-6" style={{ borderBottom: '1px solid var(--border)' }}>
        {SETTINGS_TABS.map(t => (
          <Tab key={t.key} active={tab === t.key} onClick={() => setTab(t.key)} icon={t.icon}>
            {t.label}
          </Tab>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'keys'     && <APIKeysTab settings={settings} update={update} />}
        {tab === 'models'   && <ModelsTab settings={settings} update={update} />}
        {tab === 'defaults' && <DefaultsTab settings={settings} update={update} materials={materials} />}
        {tab === 'tts'      && <TTSDefaultsTab settings={settings} update={update} />}
        {tab === 'skills'   && (
          <SkillsTab
            skills={skills}
            onAdd={() => setSkillModal({ skill: {}, open: true })}
            onEdit={s => setSkillModal({ skill: s, open: true })}
            onDelete={deleteSkill}
          />
        )}
        {tab === 'styles'   && <StylesTab
          settings={settings}
          update={update}
          materials={materials}
          onMaterialAdded={m => setMaterials(prev => [...prev, m])}
          onMaterialDeleted={id => setMaterials(prev => prev.filter(m => m.id !== id))}
        />}
        {tab === 'info'     && <InfoTab />}
      </div>

      {/* Skill modal */}
      {skillModal.open && (
        <SkillModal
          skill={skillModal.skill}
          onSave={saveSkill}
          onClose={() => setSkillModal({ skill: null, open: false })}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 20,
            zIndex: 9999,
            maxWidth: 340,
            background: toast.type === 'success' ? 'rgba(22,163,74,0.95)' : 'rgba(220,38,38,0.95)',
            color: '#fff',
            borderRadius: 10,
            padding: '12px 16px',
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            backdropFilter: 'blur(8px)',
            border: `1px solid ${toast.type === 'success' ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.4)'}`,
            animation: 'toastIn 0.25s ease',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: 18, flexShrink: 0 }}>
            {toast.type === 'success' ? <CheckCircle size={18} /> : <XCircle size={18} />}
          </span>
          <span>{toast.msg}</span>
          <button
            onClick={() => setToast(null)}
            style={{ marginLeft: 'auto', color: 'rgba(255,255,255,0.7)', fontSize: 18, lineHeight: 1, flexShrink: 0 }}
          >×</button>
        </div>
      )}

      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-12px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  )
}
