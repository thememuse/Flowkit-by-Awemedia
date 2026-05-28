import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { fetchAPI } from '../api/client'
import type { Project } from '../types'
import ProjectDetailPage from './ProjectDetailPage'
import CreateProjectForm from '../components/studio/CreateProjectForm'
import AIProjectCreator from '../components/studio/AIProjectCreator'
import { Clapperboard, Bot, Plus, Sparkles, Palette, Calendar, Loader2, Film } from 'lucide-react'

type FilterTab = 'ACTIVE' | 'ARCHIVED' | 'ALL'

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('vi-VN')
}

function TierBadge({ tier }: { tier: string | null }) {
  if (!tier) return null
  const isTwo = tier.includes('TWO')
  return (
    <span
      className="badge"
      style={
        isTwo
          ? { background: 'rgba(245,158,11,0.15)', color: 'var(--yellow)' }
          : { background: 'rgba(124,91,245,0.15)', color: 'var(--accent)' }
      }
    >
      {isTwo ? 'TIER 2' : 'TIER 1'}
    </span>
  )
}

function ProjectCard({ project, onClick, onStudio }: {
  project: Project
  onClick: () => void
  onStudio: () => void
}) {
  return (
    <div
      className="card card-hover flex flex-col gap-3 cursor-pointer"
      onClick={onClick}
      style={{ borderRadius: 10 }}
    >
      {/* Color accent bar */}
      <div
        style={{
          height: 3,
          borderRadius: '10px 10px 0 0',
          background: 'linear-gradient(90deg, var(--accent), var(--purple))',
          marginTop: -16,
          marginLeft: -16,
          marginRight: -16,
          marginBottom: 0,
        }}
      />

      <div className="font-semibold text-sm" style={{ color: 'var(--text)' }}>
        {project.name}
      </div>

      {project.description && (
        <div
          className="text-xs"
          style={{
            color: 'var(--muted)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
            lineHeight: 1.5,
          }}
        >
          {project.description}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mt-auto pt-2" style={{ borderTop: '1px solid var(--border)' }}>
        {project.material && (
          <span className="flex items-center gap-1 badge" style={{ background: 'rgba(100,116,139,0.12)', color: 'var(--muted)' }}>
            <Palette size={9} />
            {project.material}
          </span>
        )}
        <TierBadge tier={project.user_paygate_tier} />
        <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
          <Calendar size={9} />
          {formatDate(project.created_at)}
        </span>
        <div style={{ flex: 1 }} />
        <button
          onClick={e => { e.stopPropagation(); onStudio() }}
          className="flex items-center gap-1 btn btn-secondary"
          style={{ padding: '3px 9px', fontSize: 11, color: 'var(--accent)', borderColor: 'rgba(124,91,245,0.25)' }}
        >
          <Clapperboard size={11} />
          Studio
        </button>
      </div>
    </div>
  )
}

export default function ProjectsPage() {
  const { id } = useParams<{ id?: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState<FilterTab>('ACTIVE')
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [showAICreate, setShowAICreate] = useState(false)

  function loadProjects() {
    setLoading(true)
    fetchAPI<Project[]>('/api/projects')
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadProjects() }, [])

  if (id) {
    return <ProjectDetailPage projectId={id} onBack={() => navigate('/projects')} onGoStudio={(pid) => navigate(`/studio/${pid}`)} />
  }

  const filtered = projects.filter(p => {
    if (tab === 'ALL') return p.status !== 'DELETED'
    return p.status === tab
  })

  const tabs: { key: FilterTab; label: string }[] = [
    { key: 'ACTIVE', label: 'Đang hoạt động' },
    { key: 'ARCHIVED', label: 'Lưu trữ' },
    { key: 'ALL', label: 'Tất cả' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Modals */}
      {showCreate && (
        <CreateProjectForm
          onCreated={p => { setShowCreate(false); loadProjects(); navigate(`/studio/${p.id}`) }}
          onCancel={() => setShowCreate(false)}
        />
      )}
      {showAICreate && (
        <AIProjectCreator
          onCreated={p => { setShowAICreate(false); loadProjects(); navigate(`/studio/${p.id}`) }}
          onCancel={() => setShowAICreate(false)}
        />
      )}

      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className="px-3 py-1.5 rounded text-xs font-medium transition-colors"
              style={{
                background: tab === key ? 'var(--accent)' : 'var(--card)',
                color: tab === key ? '#fff' : 'var(--muted)',
                border: tab === key ? '1px solid transparent' : '1px solid var(--border)',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setShowCreate(true)}
            className="btn btn-secondary flex items-center gap-1.5"
          >
            <Plus size={12} />
            Thủ công
          </button>
          <button
            onClick={() => setShowAICreate(true)}
            className="btn btn-primary flex items-center gap-1.5"
          >
            <Bot size={12} />
            Tạo với AI
          </button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 py-8 justify-center" style={{ color: 'var(--muted)' }}>
          <Loader2 size={14} className="spin" />
          <span className="text-xs">Đang tải dự án...</span>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16">
          <div
            className="flex items-center justify-center rounded-2xl"
            style={{ width: 64, height: 64, background: 'var(--card)', border: '1px solid var(--border)' }}
          >
            <Film size={28} color="var(--muted)" strokeWidth={1.5} />
          </div>
          <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Chưa có dự án nào</div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            Tạo dự án đầu tiên để bắt đầu sản xuất video
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="btn btn-secondary flex items-center gap-1.5"
            >
              <Plus size={12} />
              Thủ công
            </button>
            <button
              onClick={() => setShowAICreate(true)}
              className="btn btn-primary flex items-center gap-1.5"
            >
              <Sparkles size={12} />
              Tạo với AI
            </button>
          </div>
        </div>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
        >
          {filtered.map(p => (
            <ProjectCard
              key={p.id}
              project={p}
              onClick={() => navigate(`/projects/${p.id}`)}
              onStudio={() => navigate(`/studio/${p.id}`)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
