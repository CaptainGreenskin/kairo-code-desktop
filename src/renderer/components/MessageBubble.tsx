/**
 * Single message bubble. User messages get a tight right-aligned style;
 * assistant messages render as full-width markdown with inline tool calls.
 */

import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { motion } from 'framer-motion'
import type { Components } from 'react-markdown'
import type { ChatMessage } from '../stores/chat-store'
import { CodeBlock } from './CodeBlock'
import { ToolCallBlock } from './ToolCallBlock'
import { CrewRunBlock } from './CrewRunBlock'

interface MessageBubbleProps {
  message: ChatMessage
}

const FADE_IN = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: 'easeOut' as const }
}

export function MessageBubble({ message }: MessageBubbleProps): JSX.Element {
  if (message.role === 'user') {
    return (
      <motion.div {...FADE_IN} className="flex justify-end px-6 py-3">
        <div className="max-w-[80%] bg-accent/10 border border-accent/20 text-text-primary rounded-lg px-4 py-2">
          <div className="markdown-body text-[14px] leading-relaxed">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={userMarkdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        </div>
      </motion.div>
    )
  }

  // Inline crew turn — the whole lifecycle renders as one persisted message.
  if (message.crew) {
    return (
      <motion.div {...FADE_IN} className="flex justify-start px-6 py-3">
        <div className="w-full max-w-3xl">
          <CrewRunBlock crew={message.crew} />
        </div>
      </motion.div>
    )
  }

  const hasContent = message.content.length > 0
  const hasToolCalls = (message.toolCalls?.length ?? 0) > 0

  return (
    <motion.div {...FADE_IN} className="flex justify-start px-6 py-3">
      <div className="w-full max-w-3xl group/msg relative">
        <div className="text-[11px] uppercase tracking-wide text-text-muted mb-1">
          Assistant
        </div>

        {hasToolCalls && (
          <div className="mb-2">
            {message.toolCalls!.map((tc) => (
              <ToolCallBlock key={tc.id} toolCall={tc} />
            ))}
          </div>
        )}

        {hasContent && (
          <div className="markdown-body text-[14px] leading-relaxed text-text-primary">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}

        {hasContent && !message.isStreaming && (
          <CopyMessageButton content={message.content} />
        )}

        {message.isStreaming && !hasContent && !hasToolCalls && (
          <PulsingDot />
        )}

        {message.isStreaming && hasContent && (
          <span className="inline-block w-1.5 h-4 ml-0.5 bg-text-secondary align-middle animate-pulse" />
        )}
      </div>
    </motion.div>
  )
}

function CopyMessageButton({ content }: { content: string }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* ignore */ }
  }
  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      className="absolute top-0 right-0 opacity-0 group-hover/msg:opacity-100 transition-opacity text-[11px] text-text-muted hover:text-text-primary px-2 py-1 rounded bg-surface-2 border border-border"
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

function PulsingDot(): JSX.Element {
  return (
    <div className="flex items-center gap-1.5 text-text-secondary text-xs">
      <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
      <span>Thinking…</span>
    </div>
  )
}

const userMarkdownComponents: Components = {
  code({ children, ...rest }) {
    return (
      <code
        className="bg-surface-3 text-text-primary rounded px-1 py-0.5 text-[12.5px] font-mono"
        {...rest}
      >
        {children}
      </code>
    )
  },
  p: ({ children }) => <p className="my-1">{children}</p>,
  a({ children, href }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className="text-accent underline underline-offset-2">
        {children}
      </a>
    )
  },
  ul: ({ children }) => <ul className="list-disc pl-5 my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-5 my-1 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  input: ({ checked, disabled, ...rest }) => (
    <input type="checkbox" checked={checked} disabled={disabled} className="mr-1.5" {...rest} />
  )
}

const markdownComponents: Components = {
  code({ className, children, ...rest }) {
    // react-markdown 9 deprecated the `inline` prop; fenced blocks are
    // identified by the presence of a language-* className.
    const match = /language-(\w+)/.exec(className ?? '')
    const text = String(children ?? '').replace(/\n$/, '')
    if (!match) {
      return (
        <code
          className="bg-surface-3 text-text-primary rounded px-1 py-0.5 text-[12.5px] font-mono"
          {...rest}
        >
          {children}
        </code>
      )
    }
    return <CodeBlock code={text} language={match[1]} />
  },
  pre({ children }) {
    // Avoid wrapping our CodeBlock in another <pre>; react-markdown wraps
    // fenced code in <pre><code>, but our component renders its own.
    return <>{children}</>
  },
  a({ children, href }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-accent hover:text-accent-hover underline underline-offset-2"
      >
        {children}
      </a>
    )
  },
  h1: ({ children }) => (
    <h1 className="text-xl font-semibold mt-4 mb-2 text-text-primary">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-lg font-semibold mt-4 mb-2 text-text-primary">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-base font-semibold mt-3 mb-1.5 text-text-primary">{children}</h3>
  ),
  ul: ({ children }) => (
    <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-3 my-2 text-text-secondary italic">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto my-3">
      <table className="border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border px-3 py-1.5 bg-surface-2 text-left">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-border px-3 py-1.5">{children}</td>
  ),
  p: ({ children }) => <p className="my-2">{children}</p>,
  hr: () => <hr className="my-4 border-border" />,
  del: ({ children }) => <del className="text-text-muted">{children}</del>,
  input: ({ checked, disabled, ...rest }) => (
    <input type="checkbox" checked={checked} disabled={disabled} className="mr-1.5" {...rest} />
  ),
  li: ({ children }) => <li>{children}</li>
}
