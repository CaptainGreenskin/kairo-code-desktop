import { useAppStore } from '../stores/app-store'
import { useChatStore } from '../stores/chat-store'

const NO_WORKSPACE_SUGGESTIONS = [
  { label: 'Explain a codebase', prompt: 'Help me understand the structure and architecture of this codebase' },
  { label: 'Set up a project', prompt: 'Help me set up a new TypeScript project with best practices' },
  { label: 'Write a script', prompt: 'Write a script that ' },
  { label: 'Debug an issue', prompt: 'Help me debug ' }
]

const WITH_WORKSPACE_SUGGESTIONS = [
  { label: 'Summarize the codebase', prompt: 'Give me a high-level summary of this codebase — key directories, patterns, and entry points' },
  { label: 'Find and fix bugs', prompt: 'Scan this codebase for potential bugs or code quality issues' },
  { label: 'Add tests', prompt: 'Add comprehensive tests for ' },
  { label: 'Refactor code', prompt: 'Suggest refactoring opportunities to improve code quality in this project' }
]

export function WelcomeScreen(): JSX.Element {
  const workspacePath = useAppStore((s) => s.workspacePath)
  const model = useAppStore((s) => s.model)
  const suggestions = workspacePath ? WITH_WORKSPACE_SUGGESTIONS : NO_WORKSPACE_SUGGESTIONS

  const handleOpenFolder = (): void => {
    void window.kairoAPI.openFolder().then((folder) => {
      if (folder) useAppStore.getState().setWorkspacePath(folder)
    })
  }

  const handleSuggestionClick = (prompt: string): void => {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement | null
    if (textarea) {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype, 'value'
      )?.set
      nativeSetter?.call(textarea, prompt)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      textarea.focus()
    }
  }

  const workspaceName = workspacePath?.split('/').pop()

  return (
    <div className="h-full min-h-[320px] flex flex-col items-center justify-center text-center px-6">
      <div className="text-6xl mb-5 text-accent select-none">&#10022;</div>
      <h2 className="text-2xl font-semibold text-text-primary mb-1">
        Kairo Code
      </h2>

      {workspacePath ? (
        <div className="flex items-center gap-2 mt-1 mb-6">
          <span className="text-sm text-text-secondary">{workspaceName}</span>
          <span className="px-1.5 py-0.5 text-[10px] rounded bg-accent/15 text-accent font-mono">
            {model}
          </span>
        </div>
      ) : (
        <div className="mt-2 mb-6">
          <p className="text-sm text-text-muted mb-3">
            Open a workspace to get started, or ask anything.
          </p>
          <button
            type="button"
            onClick={handleOpenFolder}
            className="px-4 py-2 rounded-lg bg-accent hover:bg-accent-hover text-white text-sm font-medium transition-colors"
          >
            Open Folder
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 max-w-md w-full">
        {suggestions.map((s) => (
          <button
            key={s.label}
            type="button"
            onClick={() => handleSuggestionClick(s.prompt)}
            className="group text-left px-3.5 py-3 rounded-lg border border-border bg-surface-2 hover:border-accent/40 hover:bg-accent/5 transition-colors"
          >
            <span className="text-sm text-text-primary group-hover:text-accent transition-colors">
              {s.label}
            </span>
          </button>
        ))}
      </div>

      <div className="mt-8 text-[11px] text-text-muted space-x-4">
        <span>&#8984;K palette</span>
        <span>&#8984;N new chat</span>
        <span>&#8984;O open folder</span>
        <span>/ commands</span>
      </div>
    </div>
  )
}
