interface Commit {
  hash: string
  author: string
  date: string
  message: string
}

interface Props {
  result: string
  isError?: boolean
}

export function GitLogView({ result, isError }: Props): JSX.Element {
  if (isError) {
    return (
      <pre className="bg-surface-2 border border-danger/40 rounded p-2 text-danger text-xs overflow-x-auto">
        <code>{result}</code>
      </pre>
    )
  }

  let commits: Commit[]
  try {
    commits = JSON.parse(result) as Commit[]
  } catch {
    return (
      <pre className="bg-surface-2 border border-border rounded p-2 text-text-primary text-xs overflow-x-auto">
        <code>{result}</code>
      </pre>
    )
  }

  if (commits.length === 0) {
    return (
      <div className="bg-surface-2 border border-border rounded p-3 text-xs text-text-muted italic">
        No commits found
      </div>
    )
  }

  return (
    <div className="bg-surface-2 border border-border rounded overflow-hidden max-h-80 overflow-y-auto divide-y divide-border/50">
      {commits.map((c) => (
        <div key={c.hash} className="px-3 py-2 text-xs hover:bg-surface-3/50 transition-colors">
          <div className="flex items-center gap-2">
            <span className="font-mono text-accent text-xs">{c.hash?.slice(0, 7)}</span>
            <span className="text-text-primary flex-1 truncate">{c.message}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-text-muted text-xs">
            <span>{c.author}</span>
            <span>{formatDate(c.date)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso)
    const now = Date.now()
    const diff = now - d.getTime()
    if (diff < 60_000) return 'just now'
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
    if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`
    return d.toLocaleDateString()
  } catch {
    return iso
  }
}
