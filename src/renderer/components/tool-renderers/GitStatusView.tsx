import { ClickablePath } from '../ClickablePath'

interface GitStatusData {
  branch: string
  staged: string[]
  modified: string[]
  untracked: string[]
  clean: boolean
}

interface Props {
  result: string
  isError?: boolean
}

export function GitStatusView({ result, isError }: Props): JSX.Element {
  if (isError) {
    return (
      <pre className="bg-surface-2 border border-danger/40 rounded p-2 text-danger text-xs overflow-x-auto">
        <code>{result}</code>
      </pre>
    )
  }

  let data: GitStatusData
  try {
    data = JSON.parse(result) as GitStatusData
  } catch {
    return (
      <pre className="bg-surface-2 border border-border rounded p-2 text-text-primary text-xs overflow-x-auto">
        <code>{result}</code>
      </pre>
    )
  }

  if (data.clean) {
    return (
      <div className="bg-surface-2 border border-border rounded p-3 text-xs">
        <div className="flex items-center gap-2 mb-2">
          <BranchIcon />
          <span className="font-mono text-accent font-medium">{data.branch}</span>
        </div>
        <div className="text-text-muted italic">Working tree clean</div>
      </div>
    )
  }

  return (
    <div className="bg-surface-2 border border-border rounded p-3 text-xs space-y-2">
      <div className="flex items-center gap-2">
        <BranchIcon />
        <span className="font-mono text-accent font-medium">{data.branch}</span>
      </div>

      {data.staged.length > 0 && (
        <FileGroup label="Staged" files={data.staged} color="text-success" dotColor="bg-success" />
      )}
      {data.modified.length > 0 && (
        <FileGroup label="Modified" files={data.modified} color="text-warning" dotColor="bg-warning" />
      )}
      {data.untracked.length > 0 && (
        <FileGroup label="Untracked" files={data.untracked} color="text-text-muted" dotColor="bg-text-muted" />
      )}
    </div>
  )
}

function FileGroup({
  label,
  files,
  color,
  dotColor
}: {
  label: string
  files: string[]
  color: string
  dotColor: string
}): JSX.Element {
  return (
    <div>
      <div className={`text-xs uppercase tracking-wide ${color} mb-1`}>
        {label} ({files.length})
      </div>
      <div className="space-y-0.5">
        {files.map((f) => (
          <div key={f} className="flex items-center gap-1.5 font-mono">
            <span className={`w-1.5 h-1.5 rounded-full ${dotColor} shrink-0`} />
            <ClickablePath path={f} className="text-sm">{f}</ClickablePath>
          </div>
        ))}
      </div>
    </div>
  )
}

function BranchIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-3.5 h-3.5 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}
