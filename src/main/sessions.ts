/**
 * Session persistence in JSONL format (compatible with kairo-code-ts CLI).
 *
 * Each session lives in its own file under
 * `<userData>/sessions/<id>.jsonl`. The first line is a metadata header
 * (`{ "type": "meta", ... }`), followed by one JSON object per message.
 * Listing sessions only needs to read the first line of each file.
 *
 * Writes go through a temp-file + atomic rename to avoid leaving truncated
 * files behind on crash.
 */

import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'
import type {
  SessionFile,
  SessionMessage,
  SessionMeta
} from '../shared/types'

let sessionsDirOverride: string | null = null

function sessionsDir(): string {
  if (sessionsDirOverride) return sessionsDirOverride
  return path.join(app.getPath('userData'), 'sessions')
}

/** Test hook (unused in production). */
export function _setSessionsDir(dir: string | null): void {
  sessionsDirOverride = dir
}

async function ensureDir(): Promise<string> {
  const dir = sessionsDir()
  await fs.mkdir(dir, { recursive: true })
  return dir
}

function fileFor(id: string): string {
  return path.join(sessionsDir(), `${id}.jsonl`)
}

interface MetaHeader {
  type: 'meta'
  id: string
  name: string
  createdAt: number
  updatedAt: number
  workspaceRoot?: string
  model?: string
  messageCount: number
  preview: string
}

function buildHeader(session: SessionFile): MetaHeader {
  const firstUser = session.messages.find((m) => m.role === 'user')
  const preview = (firstUser?.content ?? '').slice(0, 80).replace(/\s+/g, ' ').trim()
  return {
    type: 'meta',
    id: session.id,
    name: session.name,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    ...(session.workspaceRoot ? { workspaceRoot: session.workspaceRoot } : {}),
    ...(session.model ? { model: session.model } : {}),
    messageCount: session.messages.length,
    preview
  }
}

function metaFromHeader(h: MetaHeader): SessionMeta {
  return {
    id: h.id,
    name: h.name,
    createdAt: h.createdAt,
    updatedAt: h.updatedAt,
    messageCount: h.messageCount,
    preview: h.preview,
    ...(h.workspaceRoot ? { workspaceRoot: h.workspaceRoot } : {}),
    ...(h.model ? { model: h.model } : {})
  }
}

async function readFirstLine(file: string): Promise<string | null> {
  // Sessions are typically modest in size; reading the whole file and
  // splitting is simpler than a streaming reader and remains O(file size)
  // either way.
  try {
    const buf = await fs.readFile(file, 'utf8')
    const newline = buf.indexOf('\n')
    return newline === -1 ? buf : buf.slice(0, newline)
  } catch {
    return null
  }
}

export async function listSessions(): Promise<SessionMeta[]> {
  const dir = await ensureDir()
  let entries: string[]
  try {
    entries = await fs.readdir(dir)
  } catch {
    return []
  }
  const out: SessionMeta[] = []
  for (const name of entries) {
    if (!name.endsWith('.jsonl')) continue
    const file = path.join(dir, name)
    const first = await readFirstLine(file)
    if (!first) continue
    try {
      const parsed = JSON.parse(first) as Partial<MetaHeader>
      if (parsed.type === 'meta' && typeof parsed.id === 'string') {
        out.push(metaFromHeader(parsed as MetaHeader))
      }
    } catch {
      // skip corrupt files
    }
  }
  // Newest first
  out.sort((a, b) => b.updatedAt - a.updatedAt)
  return out
}

export async function loadSession(id: string): Promise<SessionFile | null> {
  await ensureDir()
  let raw: string
  try {
    raw = await fs.readFile(fileFor(id), 'utf8')
  } catch {
    return null
  }
  const lines = raw.split('\n').filter((l) => l.length > 0)
  if (lines.length === 0) return null
  let header: MetaHeader | null = null
  const messages: SessionMessage[] = []
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>
      if (obj.type === 'meta' && !header) {
        header = obj as unknown as MetaHeader
      } else if (obj.type === 'message' || obj.role) {
        // Accept either { type:'message', ...SessionMessage } or a raw
        // SessionMessage. Strip the type tag if present.
        const { type: _t, ...rest } = obj as unknown as { type?: string } & SessionMessage
        messages.push(rest as SessionMessage)
      }
    } catch {
      // skip corrupt line
    }
  }
  if (!header) return null
  return {
    id: header.id,
    name: header.name,
    createdAt: header.createdAt,
    updatedAt: header.updatedAt,
    ...(header.workspaceRoot ? { workspaceRoot: header.workspaceRoot } : {}),
    ...(header.model ? { model: header.model } : {}),
    messages
  }
}

export async function saveSession(session: SessionFile): Promise<void> {
  const dir = await ensureDir()
  const target = fileFor(session.id)
  const tmp = path.join(dir, `${session.id}.jsonl.tmp-${process.pid}-${Date.now()}`)
  const header = buildHeader(session)
  const lines: string[] = [JSON.stringify(header)]
  for (const m of session.messages) {
    lines.push(JSON.stringify({ type: 'message', ...m }))
  }
  const body = lines.join('\n') + '\n'
  await fs.writeFile(tmp, body, 'utf8')
  await fs.rename(tmp, target)
}

export async function deleteSession(id: string): Promise<boolean> {
  await ensureDir()
  try {
    await fs.unlink(fileFor(id))
    return true
  } catch {
    return false
  }
}

export interface CreateSessionInput {
  name?: string
  workspaceRoot?: string
  model?: string
}

export async function createSession(
  input: CreateSessionInput = {}
): Promise<SessionFile> {
  const now = Date.now()
  const session: SessionFile = {
    id: randomUUID(),
    name: input.name ?? 'New chat',
    createdAt: now,
    updatedAt: now,
    ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    ...(input.model ? { model: input.model } : {}),
    messages: []
  }
  await saveSession(session)
  return session
}

export async function renameSession(
  id: string,
  name: string
): Promise<SessionMeta | null> {
  const existing = await loadSession(id)
  if (!existing) return null
  const updated: SessionFile = {
    ...existing,
    name,
    updatedAt: Date.now()
  }
  await saveSession(updated)
  return metaFromHeader(buildHeader(updated))
}
