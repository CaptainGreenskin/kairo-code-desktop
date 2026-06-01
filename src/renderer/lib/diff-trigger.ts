/**
 * Detects file-mutating tool calls and seeds a pending diff in the chat
 * store. The diff component renders inline in the chat and waits for an
 * accept/reject decision before the user-visible state advances.
 *
 * Detection is name-based — the agent layer does not yet emit a typed
 * "edit" signal, so we treat well-known names as the canonical write
 * tools. New aliases can be added to {@link WRITE_TOOL_NAMES} without
 * touching the rest of the renderer.
 */

import { useChatStore } from '../stores/chat-store'
import type { PendingDiff } from '../stores/chat-store'
import type { ToolCallEvent } from '../../shared/types'

/**
 * Tool names the renderer treats as in-place file writes. The set is
 * small on purpose — adding entries here automatically opts the tool
 * into the diff-preview flow.
 */
/**
 * Tool names the renderer treats as in-place file writes. write_file and edit
 * are excluded because they go through the main-process WritePreview flow
 * which provides real gated approval.
 */
const WRITE_TOOL_NAMES: ReadonlySet<string> = new Set([
  'edit_file',
  'patch_file',
  'create_file',
  'apply_diff',
  'str_replace_editor'
])

interface ParsedWriteArgs {
  filePath: string
  newContent: string
}

/** Heuristic argument extraction. Different tools name their fields differently. */
function parseWriteArgs(args: Record<string, unknown>): ParsedWriteArgs | null {
  const filePath = pickString(args, ['filePath', 'file_path', 'path', 'target', 'file'])
  const newContent = pickString(args, [
    'content',
    'new_content',
    'newContent',
    'text',
    'body',
    'data'
  ])
  if (!filePath || newContent === undefined) return null
  return { filePath, newContent }
}

function pickString(
  args: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string') return value
  }
  return undefined
}

const EXT_TO_LANG: Record<string, string> = {
  ts: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  md: 'markdown',
  py: 'python',
  sh: 'bash',
  yaml: 'yaml',
  yml: 'yaml',
  html: 'html',
  css: 'css',
  go: 'go',
  rs: 'rust',
  java: 'java',
  rb: 'ruby',
  php: 'php',
  c: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  h: 'cpp',
  hpp: 'cpp'
}

function languageFromPath(filePath: string): string {
  const dot = filePath.lastIndexOf('.')
  if (dot < 0) return 'text'
  const ext = filePath.slice(dot + 1).toLowerCase()
  return EXT_TO_LANG[ext] ?? 'text'
}

/**
 * Inspect a freshly-arrived tool call. If it looks like a file write,
 * read the current file from disk (best-effort) and stash a pending
 * diff in the chat store. Safe to call for every tool call — non-write
 * names short-circuit immediately.
 */
function applyReplacements(
  original: string,
  replacements: Array<{ oldText: string; newText: string }>
): string | null {
  let result = original
  for (const { oldText, newText } of replacements) {
    if (!oldText) return null
    const idx = result.indexOf(oldText)
    if (idx === -1) return null
    result = result.slice(0, idx) + newText + result.slice(idx + oldText.length)
  }
  return result
}

function parseEditArgs(
  args: Record<string, unknown>
): { filePath: string; replacements: Array<{ oldText: string; newText: string }> } | null {
  const filePath = pickString(args, ['filePath', 'file_path', 'path', 'target', 'file'])
  if (!filePath) return null
  const raw = args.replacements
  if (!Array.isArray(raw) || raw.length === 0) return null
  const replacements: Array<{ oldText: string; newText: string }> = []
  for (const r of raw) {
    if (r && typeof r === 'object' && typeof (r as Record<string, unknown>).oldText === 'string') {
      replacements.push({
        oldText: (r as Record<string, unknown>).oldText as string,
        newText: typeof (r as Record<string, unknown>).newText === 'string'
          ? ((r as Record<string, unknown>).newText as string)
          : ''
      })
    }
  }
  return replacements.length > 0 ? { filePath, replacements } : null
}

export async function maybeTriggerPendingDiff(event: ToolCallEvent): Promise<void> {
  if (!WRITE_TOOL_NAMES.has(event.name)) return

  // Special handling for the edit tool (search-and-replace format).
  if (event.name === 'edit') {
    const editArgs = parseEditArgs(event.args)
    if (!editArgs) return
    let originalContent = ''
    try {
      const result = await window.kairoAPI.readFile(editArgs.filePath)
      if (result.ok && typeof result.content === 'string') {
        originalContent = result.content
      }
    } catch { /* best-effort */ }
    const newContent = applyReplacements(originalContent, editArgs.replacements)
    if (newContent === null) return
    const diff: PendingDiff = {
      id: `diff-${event.toolCallId}`,
      toolCallId: event.toolCallId,
      filePath: editArgs.filePath,
      originalContent,
      newContent,
      language: languageFromPath(editArgs.filePath),
      status: 'pending'
    }
    useChatStore.getState().addPendingDiff(diff)
    return
  }

  const parsed = parseWriteArgs(event.args)
  if (!parsed) return

  let originalContent = ''
  try {
    const result = await window.kairoAPI.readFile(parsed.filePath)
    if (result.ok && typeof result.content === 'string') {
      originalContent = result.content
    }
  } catch {
    // best-effort
  }

  const diff: PendingDiff = {
    id: `diff-${event.toolCallId}`,
    toolCallId: event.toolCallId,
    filePath: parsed.filePath,
    originalContent,
    newContent: parsed.newContent,
    language: languageFromPath(parsed.filePath),
    status: 'pending'
  }
  useChatStore.getState().addPendingDiff(diff)
}
