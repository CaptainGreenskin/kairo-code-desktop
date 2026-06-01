import { ClickablePath } from '../ClickablePath'

interface Props {
  result: string
  isError?: boolean
}

export function GitDiffView({ result, isError }: Props): JSX.Element {
  if (isError || result === '(no changes)') {
    return (
      <pre
        className={
          'bg-surface-2 border rounded p-2 text-xs overflow-x-auto whitespace-pre-wrap break-words ' +
          (isError ? 'border-danger/40 text-danger' : 'border-border text-text-muted italic')
        }
      >
        <code>{result}</code>
      </pre>
    )
  }

  const lines = result.split('\n')

  return (
    <div className="bg-surface-2 border border-border rounded overflow-hidden max-h-80 overflow-y-auto">
      <pre className="p-2 text-xs font-mono leading-relaxed">
        {lines.map((line, i) => {
          const diffPath = extractDiffPath(line)
          return (
            <div key={i} className={lineClass(line)}>
              {diffPath ? (
                <>
                  {line.slice(0, line.indexOf(diffPath))}
                  <ClickablePath path={diffPath} className="text-inherit hover:underline">
                    {diffPath}
                  </ClickablePath>
                  {line.slice(line.indexOf(diffPath) + diffPath.length)}
                </>
              ) : (
                line
              )}
            </div>
          )
        })}
      </pre>
    </div>
  )
}

function extractDiffPath(line: string): string | null {
  if (line.startsWith('+++ b/')) return line.slice(6)
  if (line.startsWith('--- a/')) return line.slice(6)
  const diffMatch = line.match(/^diff --git a\/(.+?) b\//)
  if (diffMatch) return diffMatch[1]!
  return null
}

function lineClass(line: string): string {
  if (line.startsWith('+++') || line.startsWith('---')) return 'text-text-muted'
  if (line.startsWith('@@')) return 'text-accent'
  if (line.startsWith('+')) return 'text-success bg-success/5'
  if (line.startsWith('-')) return 'text-danger bg-danger/5'
  if (line.startsWith('diff ')) return 'text-text-muted font-medium border-t border-border/50 pt-1 mt-1'
  return 'text-text-secondary'
}
