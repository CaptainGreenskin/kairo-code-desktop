import { useEffect, useMemo, useState } from 'react'
import { Button } from './ui/Button'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useAppStore } from '../stores/app-store'
import { buildProjectBriefing, type ProjectBriefing } from '../../shared/project-briefing'
import type { CodeMap } from '../../shared/code-map'

const SUGGESTIONS = [
  { label: '核心架构', prompt: '这个项目的核心架构是什么？主要模块各自的职责？' },
  { label: '最近变更', prompt: '最近的代码变更有哪些？有什么需要关注的风险？' },
  { label: '依赖关系', prompt: '帮我分析这个项目的模块依赖关系，哪些模块耦合度最高？' },
  { label: '帮我改代码', prompt: '帮我' }
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

  return (
    <div className="h-full min-h-[320px] flex flex-col items-center justify-center px-8 max-w-2xl mx-auto">
      {briefing ? (
        <div className="w-full space-y-4" data-testid="project-briefing">
          <div className="text-sm text-text-primary leading-relaxed markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{briefing.text}</ReactMarkdown>
          </div>

          {briefing.entryPoints.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {briefing.entryPoints.map((e) => (
                <button
                  key={e.path}
                  type="button"
                  onClick={() => fillInput(`帮我理解 ${e.path} 模块`)}
                  className="px-2 py-1 text-xs rounded border border-border bg-surface-2 text-text-secondary hover:text-accent hover:border-accent/40 font-mono truncate max-w-[200px]"
                  title={`${e.path} — ${e.reason}`}
                >
                  {e.path.split('/').slice(-2).join('/')}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center">
          <div className="text-4xl mb-3 text-accent select-none">&#10022;</div>
          <h2 className="text-xl font-semibold text-text-primary mb-1">正在扫描项目…</h2>
          <p className="text-sm text-text-muted">{workspacePath?.split('/').pop() ?? ''}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 w-full mt-6">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => fillInput(s.prompt)}
            className="group text-left px-3.5 py-2.5 rounded-lg border border-border bg-surface-2 hover:border-accent/40 hover:bg-accent/5 transition-colors"
          >
            <span className="text-sm text-text-primary group-hover:text-accent transition-colors">
              {s.label}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
