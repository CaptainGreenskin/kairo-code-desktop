import { useEffect, useMemo, useState } from 'react'
import { Button } from './ui/Button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../stores/app-store'
import { buildProjectBriefing, type ProjectBriefing } from '../../shared/project-briefing'
import type { CodeMap } from '../../shared/code-map'

const SUGGESTIONS = [
  { icon: '🏗️', label: '核心架构', desc: '模块职责与设计', prompt: '这个项目的核心架构是什么？主要模块各自的职责？' },
  { icon: '🔄', label: '最近变更', desc: '风险与影响', prompt: '最近的代码变更有哪些？有什么需要关注的风险？' },
  { icon: '🔗', label: '依赖关系', desc: '耦合度分析', prompt: '帮我分析这个项目的模块依赖关系，哪些模块耦合度最高？' },
  { icon: '✏️', label: '帮我改代码', desc: '编写或修改', prompt: '帮我' }
]

export function WelcomeScreen(): JSX.Element {
  const workspacePath = useAppStore((s) => s.workspacePath)
  const [map, setMap] = useState<CodeMap | null>(null)
  const [commits, setCommits] = useState<Array<{ author: string; at: number; files: string[]; subject: string }>>([])
  const [files, setFiles] = useState<string[]>([])

  // Scan the project on mount (independent of Code Map panel state).
  useEffect(() => {
    const ws = workspacePath ?? undefined
    void window.kairoAPI?.getCodeMap?.(ws)
      .then((r) => { if (r?.ok && r.map) setMap(r.map as CodeMap) })
      .catch(() => {})
  }, [workspacePath])

  useEffect(() => {
    const ws = workspacePath ?? undefined
    void window.kairoAPI.getGitHistory?.(ws, 50)
      .then((r) => {
        if (r?.ok && r.commits) {
          setCommits(r.commits.map((c: { hash: string; at: number; author: string; subject: string; files: string[] }) => ({
            author: c.author, at: c.at, files: c.files, subject: c.subject
          })))
        }
      }).catch(() => {})
    if (workspacePath) {
      void window.kairoAPI.listAllFiles?.(workspacePath)
        .then((r) => {
          if (Array.isArray(r)) setFiles(r.map((f: { relativePath: string }) => f.relativePath))
        }).catch(() => {})
    }
  }, [workspacePath])

  const briefing = useMemo<ProjectBriefing | null>(() => {
    if (!map) return null
    return buildProjectBriefing({
      modules: map.modules.map((m) => ({ id: m.id, fileCount: m.fileCount, loc: m.loc })),
      edges: map.edges,
      commits,
      files
    })
  }, [map, commits, files])

  const handleOpenFolder = (): void => {
    void window.kairoAPI.openFolder().then((folder) => {
      if (folder) useAppStore.getState().setWorkspacePath(folder)
    })
  }

  const fillInput = (prompt: string): void => {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null
    if (textarea) {
      const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      nativeSetter?.call(textarea, prompt)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
    }
  }

  // No briefing yet: show a welcoming state. If map is still loading, show
  // "scanning". If truly empty (no workspace, no cwd project), show "Open Folder".
  if (!briefing) {
    return (
      <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center px-6">
        <div className="text-5xl mb-4 text-accent select-none">&#10022;</div>
        <h2 className="text-2xl font-semibold text-text-primary mb-1">Kairo Code</h2>
        <p className="text-sm text-text-muted mt-2 mb-4">
          The coding tool that makes sure you understand what AI builds for you.
        </p>
        {map ? (
          <p className="text-sm text-text-muted animate-pulse">正在分析项目…</p>
        ) : (
          <Button variant="primary" onClick={handleOpenFolder}>Open Folder</Button>
        )}
        <div className="mt-6 text-xs text-text-muted space-x-4">
          <span>&#8984;K palette</span>
          <span>&#8984;N new chat</span>
          <span>&#8984;O open folder</span>
        </div>
      </div>
    )
  }

  const projectName = workspacePath?.split('/').pop() ?? 'project'

  return (
    <div className="h-full min-h-[320px] flex flex-col items-center justify-center px-8 max-w-2xl mx-auto">
      {briefing ? (
        <div className="w-full space-y-5" data-testid="project-briefing">
          {/* Hero: project identity */}
          <div className="text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-xs font-medium mb-3">
              <span>✦</span>
              <span>{briefing.identity}</span>
            </div>
            <h2 className="text-lg font-semibold text-text-primary">{projectName}</h2>
            <p className="text-xs text-text-muted mt-1">
              {briefing.scale.modules} 模块 · {briefing.scale.deps} 依赖 · {briefing.stack.join(' · ')}
            </p>
          </div>

          {/* Stats cards */}
          <div className="grid grid-cols-3 gap-2">
            {briefing.entryPoints.slice(0, 3).map((e) => (
              <button
                key={e.path}
                type="button"
                onClick={() => fillInput(`帮我理解 ${e.path} 模块`)}
                className="group text-left p-3 rounded-xl bg-surface-2/80 border border-border/60 hover:border-accent/40 hover:bg-accent/5 transition-all duration-150 hover-lift"
                title={e.reason}
              >
                <div className="text-xs font-mono text-accent truncate">{e.path.split('/').pop()}</div>
                <div className="text-xs text-text-muted mt-0.5 truncate">{e.reason}</div>
              </button>
            ))}
          </div>

          {/* Activity summary */}
          {briefing.hotspots.length > 0 && (
            <div className="rounded-xl bg-surface-2/50 border border-border/40 p-3">
              <div className="text-xs text-text-muted mb-2">最近活跃</div>
              <div className="flex flex-wrap gap-1.5">
                {briefing.hotspots.map((h) => (
                  <button
                    key={h.module}
                    type="button"
                    onClick={() => fillInput(`${h.module} 模块最近在做什么？`)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-3 text-xs text-text-secondary hover:text-accent hover:bg-accent/10 transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-success" />
                    <span className="font-mono">{h.module.split('/').pop()}</span>
                    <span className="text-text-muted">{h.commits}次</span>
                  </button>
                ))}
              </div>
              {briefing.authors.length > 0 && (
                <div className="text-xs text-text-muted mt-2">
                  {briefing.authors.map((a) => a.name).join('、')}
                </div>
              )}
            </div>
          )}

          {/* Risk alert */}
          {briefing.stale.length > 0 && (
            <div className="rounded-xl bg-warning/5 border border-warning/20 p-3">
              <div className="text-xs text-warning font-medium mb-1">⚠️ 风险模块</div>
              <div className="text-xs text-text-secondary">
                {briefing.stale.map((s) => `${s.module.split('/').pop()} (${s.daysSinceChange}天未动, 被${s.dependents}模块依赖)`).join('、')}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="text-center">
          <div className="text-5xl mb-4 text-accent select-none animate-pulse">✦</div>
          <h2 className="text-lg font-semibold text-text-primary mb-1">正在扫描项目…</h2>
          <p className="text-xs text-text-muted">{projectName}</p>
        </div>
      )}

      {/* Suggestion cards with icons */}
      <div className="grid grid-cols-2 gap-2.5 w-full mt-6">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => fillInput(s.prompt)}
            className="group text-left px-4 py-3 rounded-xl border border-border/60 bg-surface-2/60 hover:border-accent/30 hover:bg-accent/5 transition-all duration-150 hover-lift"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">{s.icon}</span>
              <span className="text-sm font-medium text-text-primary group-hover:text-accent transition-colors">{s.label}</span>
            </div>
            <div className="text-xs text-text-muted mt-0.5 ml-7">{s.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
