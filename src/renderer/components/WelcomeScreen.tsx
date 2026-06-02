/**
 * Welcome screen — shown when a session has no messages yet. Clean, fast,
 * no background scanning. Just the project name + suggestion cards. The user
 * can start chatting immediately.
 */

import { useAppStore } from '../stores/app-store'
import { Button } from './ui/Button'

const SUGGESTIONS = [
  { icon: '🏗️', label: '核心架构', desc: '模块职责与设计', prompt: '这个项目的核心架构是什么？主要模块各自的职责？' },
  { icon: '🔄', label: '最近变更', desc: '风险与影响', prompt: '最近的代码变更有哪些？有什么需要关注的风险？' },
  { icon: '🔗', label: '依赖关系', desc: '耦合度分析', prompt: '帮我分析这个项目的模块依赖关系，哪些模块耦合度最高？' },
  { icon: '✏️', label: '帮我改代码', desc: '编写或修改', prompt: '帮我' }
]

export function WelcomeScreen(): JSX.Element {
  const workspacePath = useAppStore((s) => s.workspacePath)

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

  if (!workspacePath) {
    return (
      <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center px-6">
        <div className="text-5xl mb-4 text-accent select-none">✦</div>
        <h2 className="text-2xl font-semibold text-text-primary mb-1">Kairo Code</h2>
        <p className="text-sm text-text-muted mt-2 mb-5">
          The coding tool that makes sure you understand what AI builds for you.
        </p>
        <Button variant="primary" onClick={handleOpenFolder} className="px-6">📂 打开项目文件夹</Button>
      </div>
    )
  }

  const projectName = workspacePath.split('/').pop() ?? 'project'

  return (
    <div className="h-full min-h-[320px] flex flex-col items-center justify-center px-8 max-w-2xl mx-auto">
      <div className="text-center mb-6">
        <div className="text-4xl mb-3 text-accent select-none">✦</div>
        <h2 className="text-lg font-semibold text-text-primary">{projectName}</h2>
        <p className="text-xs text-text-muted mt-1">有什么可以帮你的？</p>
      </div>

      <div className="grid grid-cols-2 gap-2.5 w-full">
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
