import { ClickablePath } from '../ClickablePath'

interface BashResultViewProps {
  result: string
  isError?: boolean
}

interface ParsedBash {
  stdout: string
  stderr: string
  exitLine: string
}

function parseBashResult(raw: string): ParsedBash {
  const sections = raw.split('\n\n')
  let stdout = ''
  let stderr = ''
  let exitLine = ''

  for (const section of sections) {
    if (section.startsWith('[stdout]\n')) {
      stdout = section.slice('[stdout]\n'.length)
    } else if (section.startsWith('[stderr]\n')) {
      stderr = section.slice('[stderr]\n'.length)
    } else if (section.startsWith('[exit]')) {
      exitLine = section.slice('[exit] '.length)
    }
  }
  return { stdout, stderr, exitLine }
}

const PATH_LINE_RE = /^(\S+\.\w+):(\d+)(?::(\d+))?/
const PAREN_PATH_RE = /\(([^()\s]+\.\w+):(\d+)(?::(\d+))?\)/g

function linkifyLine(line: string, idx: number): React.ReactNode {
  const startMatch = PATH_LINE_RE.exec(line)
  if (startMatch) {
    const [matched, filePath, lineStr] = startMatch
    const lineNum = parseInt(lineStr!, 10)
    const rest = line.slice(matched!.length)
    return (
      <span key={idx}>
        <ClickablePath path={filePath!} line={lineNum} className="text-sm">
          {filePath}:{lineStr}
        </ClickablePath>
        {rest}
        {'\n'}
      </span>
    )
  }

  const parts: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  PAREN_PATH_RE.lastIndex = 0
  let partIdx = 0

  while ((match = PAREN_PATH_RE.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(line.slice(lastIndex, match.index))
    }
    const [full, filePath, lineStr] = match
    const lineNum = parseInt(lineStr!, 10)
    parts.push(
      <span key={`p-${idx}-${partIdx++}`}>
        {'('}
        <ClickablePath path={filePath!} line={lineNum} className="text-sm">
          {filePath}:{lineStr}
        </ClickablePath>
        {')'}
      </span>
    )
    lastIndex = match.index + full!.length
  }

  if (parts.length > 0) {
    if (lastIndex < line.length) {
      parts.push(line.slice(lastIndex))
    }
    return <span key={idx}>{parts}{'\n'}</span>
  }

  return line + '\n'
}

function linkifyOutput(text: string): React.ReactNode[] {
  if (!text) return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines.map((line, i) => linkifyLine(line, i))
}

export function BashResultView({ result, isError }: BashResultViewProps): JSX.Element {
  const parsed = parseBashResult(result)
  const hasStructure = parsed.stdout || parsed.stderr || parsed.exitLine

  if (!hasStructure) {
    return (
      <pre
        className={
          'bg-gray-950 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-sm leading-5 ' +
          (isError ? 'border-danger/40 text-danger' : 'border-border text-gray-300')
        }
      >
        <code>{linkifyOutput(result)}{result ? null : '(no output)'}</code>
      </pre>
    )
  }

  return (
    <div className="bg-gray-950 border border-border rounded overflow-hidden font-mono text-sm leading-5">
      {parsed.stdout && (
        <pre className="p-2 overflow-x-auto whitespace-pre-wrap break-words text-gray-300">
          <code>{linkifyOutput(parsed.stdout)}</code>
        </pre>
      )}
      {parsed.stderr && (
        <pre className="p-2 overflow-x-auto whitespace-pre-wrap break-words text-warning border-t border-border">
          <code>{linkifyOutput(parsed.stderr)}</code>
        </pre>
      )}
      {parsed.exitLine && (
        <div
          className={
            'px-2 py-1 border-t border-border text-xs ' +
            (isError ? 'text-danger bg-danger/5' : 'text-text-muted bg-surface-1')
          }
        >
          {parsed.exitLine}
        </div>
      )}
    </div>
  )
}
