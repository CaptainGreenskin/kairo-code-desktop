import { ClickablePath } from '../ClickablePath'
import { CodeBlock } from '../CodeBlock'

interface ReadFileResultViewProps {
  result: string
  isError?: boolean
  args: Record<string, unknown>
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
  json: 'json', md: 'markdown', py: 'python', sh: 'bash',
  yaml: 'yaml', yml: 'yaml', html: 'html', css: 'css',
  go: 'go', rs: 'rust', java: 'java', rb: 'ruby', php: 'php',
  c: 'c', cpp: 'cpp', cc: 'cpp', h: 'cpp', hpp: 'cpp',
  toml: 'toml', xml: 'xml', sql: 'sql', swift: 'swift', kt: 'kotlin',
  vue: 'vue', svelte: 'svelte', scss: 'scss', less: 'less'
}

function langFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'text'
  return EXT_TO_LANG[filePath.slice(dot + 1).toLowerCase()] ?? 'text'
}

const MAX_PREVIEW_LINES = 100

export function ReadFileResultView({ result, isError, args }: ReadFileResultViewProps): JSX.Element {
  if (isError) {
    return (
      <pre className="bg-surface-2 border border-danger/40 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-danger text-[12px] font-mono">
        <code>{result}</code>
      </pre>
    )
  }

  const filePath = typeof args.path === 'string' ? args.path : ''
  const language = langFromPath(filePath)
  const lines = result.split('\n')
  const truncated = lines.length > MAX_PREVIEW_LINES
  const displayCode = truncated
    ? lines.slice(0, MAX_PREVIEW_LINES).join('\n') + `\n\n… (${lines.length - MAX_PREVIEW_LINES} more lines)`
    : result

  return (
    <div>
      {filePath && (
        <div className="mb-1 text-[11px]">
          <ClickablePath path={filePath}>{filePath}</ClickablePath>
        </div>
      )}
      <CodeBlock code={displayCode} language={language} />
    </div>
  )
}
