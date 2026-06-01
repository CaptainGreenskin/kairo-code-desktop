import { useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

export interface SlashCommand {
  name: string
  description: string
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'new', description: 'Start a new conversation' },
  { name: 'clear', description: 'Clear current chat messages' },
  { name: 'compact', description: 'Compress older context to save tokens' },
  { name: 'export', description: 'Export chat as Markdown' },
  { name: 'crew', description: 'Run a multi-agent crew on a task' },
  { name: 'model', description: 'Change the AI model' },
  { name: 'settings', description: 'Open settings panel' },
  { name: 'workspace', description: 'Change workspace folder' },
  { name: 'help', description: 'Show available commands' }
]

interface SlashCommandMenuProps {
  filter: string
  selectedIndex: number
  onSelect: (cmd: SlashCommand) => void
  onHover: (index: number) => void
}

export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().replace(/^\//, '')
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(q))
}

export function SlashCommandMenu({
  filter,
  selectedIndex,
  onSelect,
  onHover
}: SlashCommandMenuProps): JSX.Element {
  const filtered = filterCommands(filter)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  if (filtered.length === 0) return <></>

  return (
    <motion.div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-surface-2 border border-border rounded-lg shadow-xl overflow-hidden max-h-52 overflow-y-auto z-20"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.1 }}
    >
      {filtered.map((cmd, i) => (
        <button
          key={cmd.name}
          type="button"
          onClick={() => onSelect(cmd)}
          onMouseEnter={() => onHover(i)}
          className={
            'w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors ' +
            (i === selectedIndex
              ? 'bg-accent/10 text-text-primary'
              : 'text-text-secondary hover:bg-surface-3')
          }
        >
          <span className="font-mono text-accent text-xs">/{cmd.name}</span>
          <span className="text-text-muted text-xs">{cmd.description}</span>
        </button>
      ))}
    </motion.div>
  )
}
