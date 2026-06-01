import * as path from 'node:path'
import { spawn } from 'node:child_process'
import { readdir, readFile, stat } from 'node:fs/promises'

export interface GrepMatch {
  file: string
  line: number
  text: string
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.turbo', '.cache', 'coverage'
])

const looksBinary = (buf: Buffer): boolean => {
  const sample = Math.min(buf.length, 8 * 1024)
  for (let i = 0; i < sample; i++) {
    if (buf[i] === 0) return true
  }
  return false
}

function tryRipgrep(
  pattern: string,
  searchPath: string,
  include: string | undefined,
  maxResults: number
): Promise<GrepMatch[] | null> {
  return new Promise((resolve) => {
    const args = ['--no-heading', '--line-number', '--color', 'never', '-m', String(maxResults)]
    if (include) args.push('--glob', include)
    args.push('--', pattern, searchPath)

    const child = spawn('rg', args)
    let stdout = ''

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString('utf-8') })
    child.on('error', () => resolve(null))
    child.on('close', (code) => {
      if (code === 2) { resolve(null); return }
      const matches: GrepMatch[] = []
      for (const line of stdout.split('\n')) {
        if (!line) continue
        const firstColon = line.indexOf(':')
        if (firstColon === -1) continue
        const secondColon = line.indexOf(':', firstColon + 1)
        if (secondColon === -1) continue
        const file = line.slice(0, firstColon)
        const lineNo = parseInt(line.slice(firstColon + 1, secondColon), 10)
        const text = line.slice(secondColon + 1)
        if (!Number.isFinite(lineNo)) continue
        matches.push({ file, line: lineNo, text })
        if (matches.length >= maxResults) break
      }
      resolve(matches)
    })
  })
}

async function fallbackGrep(
  pattern: string,
  searchPath: string,
  include: string | undefined,
  maxResults: number
): Promise<GrepMatch[]> {
  const regex = new RegExp(pattern)
  const includeRe = include ? globToRegExp(include) : null
  const matches: GrepMatch[] = []

  const visit = async (current: string): Promise<void> => {
    if (matches.length >= maxResults) return
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (matches.length >= maxResults) return
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        await visit(full)
      } else if (entry.isFile()) {
        if (includeRe && !includeRe.test(entry.name)) continue
        try {
          const buf = await readFile(full)
          if (looksBinary(buf)) continue
          const text = buf.toString('utf-8')
          const lines = text.split('\n')
          for (let i = 0; i < lines.length; i++) {
            if (regex.test(lines[i]!)) {
              matches.push({ file: full, line: i + 1, text: lines[i]! })
              if (matches.length >= maxResults) return
            }
          }
        } catch { /* skip unreadable */ }
      }
    }
  }

  const info = await stat(searchPath).catch(() => null)
  if (!info) return matches
  if (info.isFile()) {
    try {
      const buf = await readFile(searchPath)
      if (!looksBinary(buf)) {
        const text = buf.toString('utf-8')
        const lines = text.split('\n')
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i]!)) {
            matches.push({ file: searchPath, line: i + 1, text: lines[i]! })
            if (matches.length >= maxResults) break
          }
        }
      }
    } catch { /* ignore */ }
  } else {
    await visit(searchPath)
  }
  return matches
}

function globToRegExp(glob: string): RegExp {
  let re = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!
    if (c === '*') re += '[^/]*'
    else if (c === '?') re += '[^/]'
    else if ('.+^$()|{}\\'.includes(c)) re += `\\${c}`
    else re += c
  }
  return new RegExp(`^${re}$`)
}

export async function grepFiles(
  searchPath: string,
  pattern: string,
  include?: string,
  maxResults = 100
): Promise<GrepMatch[]> {
  try { new RegExp(pattern) } catch {
    return []
  }
  let matches = await tryRipgrep(pattern, searchPath, include, maxResults)
  if (!matches) {
    matches = await fallbackGrep(pattern, searchPath, include, maxResults)
  }
  return matches
}
