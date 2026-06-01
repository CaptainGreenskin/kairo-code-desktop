/**
 * Async-highlighted code block.
 *
 * react-markdown can only render synchronously, but shiki's `codeToHtml`
 * is async. We seed the block with the raw source, kick off shiki in an
 * effect, and swap in the highlighted HTML once it lands. The plain
 * fallback is fully readable on its own.
 */

import { useEffect, useState } from 'react'
import { highlight } from '../lib/highlighter'
import { useToastStore } from '../stores/toast-store'

interface CodeBlockProps {
  code: string
  language?: string
}

export function CodeBlock({ code, language }: CodeBlockProps): JSX.Element {
  const [html, setHtml] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    highlight(code, language)
      .then((rendered) => {
        if (!cancelled) setHtml(rendered)
      })
      .catch(() => {
        if (!cancelled) setHtml(null)
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      useToastStore.getState().addToast({ type: 'success', message: 'Copied to clipboard' })
    } catch {
      // ignore clipboard failures
    }
  }

  return (
    <div className="relative my-3 group">
      <div className="flex items-center justify-between px-3 py-1.5 bg-surface-0 border border-border border-b-0 rounded-t-md text-xs text-text-muted">
        <span className="font-mono">{language || 'text'}</span>
        <button
          type="button"
          onClick={copy}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-text-secondary hover:text-text-primary"
        >
          Copy
        </button>
      </div>
      {html ? (
        <div
          className="shiki-host text-sm leading-relaxed border border-border rounded-b-md overflow-x-auto"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="text-sm leading-relaxed bg-surface-0 border border-border rounded-b-md p-3 overflow-x-auto text-text-primary">
          <code>{code}</code>
        </pre>
      )}
    </div>
  )
}
