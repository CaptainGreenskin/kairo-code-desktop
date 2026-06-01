import { ClickablePath } from '../ClickablePath'

interface GrepResultViewProps {
  result: string
  isError?: boolean
}

interface FileGroup {
  file: string
  lines: Array<{ num: number; text: string }>
}

function parseGrepResult(raw: string): FileGroup[] {
  const groups: FileGroup[] = []
  let current: FileGroup | null = null
  for (const line of raw.split('\n')) {
    if (!line) continue
    const firstColon = line.indexOf(':')
    if (firstColon === -1) continue
    const secondColon = line.indexOf(':', firstColon + 1)
    if (secondColon === -1) continue
    const file = line.slice(0, firstColon)
    const num = parseInt(line.slice(firstColon + 1, secondColon), 10)
    const text = line.slice(secondColon + 1)
    if (!Number.isFinite(num)) continue
    if (!current || current.file !== file) {
      current = { file, lines: [] }
      groups.push(current)
    }
    current.lines.push({ num, text })
  }
  return groups
}

export function GrepResultView({ result, isError }: GrepResultViewProps): JSX.Element {
  if (isError || !result) {
    return (
      <pre className="bg-surface-2 border border-danger/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-danger">
        <code>{result || 'No output'}</code>
      </pre>
    )
  }

  const groups = parseGrepResult(result)
  if (groups.length === 0) {
    return (
      <div className="bg-surface-2 border border-border rounded p-2 text-text-muted italic">
        {result}
      </div>
    )
  }

  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.file} className="bg-surface-2 border border-border rounded overflow-hidden">
          <div className="px-2 py-1 bg-surface-3 text-xs truncate">
            <ClickablePath path={group.file}>{group.file}</ClickablePath>
          </div>
          <div className="divide-y divide-border">
            {group.lines.map((line, i) => (
              <ClickablePath
                key={`${group.file}:${line.num}:${i}`}
                path={group.file}
                line={line.num}
                className="flex font-mono text-sm leading-5 hover:bg-surface-3/50 w-full no-underline hover:no-underline"
              >
                <span className="w-10 shrink-0 text-right pr-2 text-text-muted select-none border-r border-border bg-surface-1">
                  {line.num}
                </span>
                <span className="px-2 text-text-primary overflow-x-auto whitespace-pre">
                  {line.text}
                </span>
              </ClickablePath>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
