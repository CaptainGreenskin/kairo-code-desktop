import { ClickablePath } from '../ClickablePath'

interface EditResultViewProps {
  result: string
  isError?: boolean
  args: Record<string, unknown>
}

export function EditResultView({ result, isError, args }: EditResultViewProps): JSX.Element {
  if (isError) {
    return (
      <pre className="bg-surface-2 border border-danger/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-danger text-sm font-mono">
        <code>{result}</code>
      </pre>
    )
  }

  const filePath = typeof args.path === 'string' ? args.path : ''
  const replacements = Array.isArray(args.replacements) ? args.replacements : []

  return (
    <div className="bg-surface-2 border border-border rounded overflow-hidden">
      <div className="px-2 py-1.5 flex items-center gap-2 text-sm">
        <svg
          viewBox="0 0 24 24"
          className="w-3.5 h-3.5 text-success shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M5 12l4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="text-text-primary">
          {replacements.length} replacement{replacements.length === 1 ? '' : 's'} applied
        </span>
        {filePath && (
          <ClickablePath path={filePath} className="truncate ml-1 text-sm">
            {filePath}
          </ClickablePath>
        )}
      </div>
    </div>
  )
}
