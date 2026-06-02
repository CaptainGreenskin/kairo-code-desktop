/**
 * Project Briefing — 10 seconds to first value. Scans a project and produces
 * a one-paragraph human-readable briefing: what is this, what tech, what's hot,
 * what's cold, who's active. Pure rules, no LLM, instant.
 */

export interface ProjectBriefing {
  /** One-line identity: "Python AI Agent framework" / "TypeScript React app" */
  identity: string
  /** Detected languages + frameworks. */
  stack: string[]
  /** Total file count and lines of code. */
  scale: { files: number; modules: number; deps: number }
  /** The 3 largest / most-connected files (the "you should start here" files). */
  entryPoints: Array<{ path: string; reason: string }>
  /** Most active modules in recent git history. */
  hotspots: Array<{ module: string; commits: number; authors: string[] }>
  /** Modules not touched in a long time but heavily depended on (risk). */
  stale: Array<{ module: string; daysSinceChange: number; dependents: number }>
  /** Active contributors (from git). */
  authors: Array<{ name: string; commits: number }>
  /** The generated human-readable briefing text. */
  text: string
}

interface BriefingInput {
  /** Module list from Code Map scan. */
  modules: Array<{ id: string; fileCount: number; loc: number }>
  edges: Array<{ from: string; to: string }>
  /** Recent git commits. */
  commits: Array<{ author: string; at: number; files: string[]; subject: string }>
  /** Files in the workspace (paths). */
  files: string[]
}

const FRAMEWORK_HINTS: Record<string, string[]> = {
  React: ['package.json:react', 'jsx', 'tsx'],
  Vue: ['package.json:vue', '.vue'],
  Angular: ['angular.json', 'package.json:@angular/core'],
  FastAPI: ['requirements.txt:fastapi', 'main.py:FastAPI'],
  Django: ['manage.py', 'settings.py:INSTALLED_APPS'],
  Spring: ['pom.xml:spring-boot', 'build.gradle:spring-boot'],
  Electron: ['package.json:electron', 'electron.vite'],
  'Next.js': ['next.config', 'package.json:next'],
}

function detectStack(files: string[]): string[] {
  const stack: string[] = []
  const exts = new Map<string, number>()
  for (const f of files) {
    const ext = f.split('.').pop()?.toLowerCase() ?? ''
    exts.set(ext, (exts.get(ext) ?? 0) + 1)
  }
  const sorted = [...exts.entries()].sort((a, b) => b[1] - a[1])
  const langMap: Record<string, string> = { ts: 'TypeScript', tsx: 'TypeScript', js: 'JavaScript', py: 'Python', java: 'Java', go: 'Go', rs: 'Rust', kt: 'Kotlin', rb: 'Ruby', cs: 'C#', cpp: 'C++', c: 'C', swift: 'Swift' }
  const seenLangs = new Set<string>()
  for (const [ext] of sorted.slice(0, 5)) {
    const lang = langMap[ext]
    if (lang && !seenLangs.has(lang)) { stack.push(lang); seenLangs.add(lang) }
  }
  const allPaths = files.join('\n').toLowerCase()
  for (const [fw, hints] of Object.entries(FRAMEWORK_HINTS)) {
    if (hints.some((h) => allPaths.includes(h.toLowerCase()))) stack.push(fw)
  }
  return stack
}

function detectIdentity(stack: string[], files: string[]): string {
  const allPaths = files.join('\n').toLowerCase()
  if (allPaths.includes('agent') && (stack.includes('Python') || stack.includes('TypeScript'))) return `${stack[0]} AI Agent 框架`
  if (stack.includes('React') && stack.includes('Electron')) return 'Electron + React 桌面应用'
  if (stack.includes('React')) return `${stack[0]} React 应用`
  if (stack.includes('FastAPI')) return 'Python FastAPI 服务'
  if (stack.includes('Spring')) return 'Java Spring Boot 服务'
  if (stack.includes('Next.js')) return 'Next.js 全栈应用'
  if (stack.length > 0) return `${stack[0]} 项目`
  return '软件项目'
}

export function buildProjectBriefing(input: BriefingInput): ProjectBriefing {
  // If no file list provided, derive file paths from module IDs.
  const fileList = input.files.length > 0 ? input.files : input.modules.map((m) => m.id + '/index.ts')
  const stack = detectStack(fileList)
  const identity = detectIdentity(stack, fileList)

  // Entry points: largest modules by LOC (the "start here" files).
  const byLoc = [...input.modules].sort((a, b) => b.loc - a.loc)
  const fanIn = new Map<string, number>()
  for (const e of input.edges) fanIn.set(e.to, (fanIn.get(e.to) ?? 0) + 1)
  const byFanIn = [...input.modules].sort((a, b) => (fanIn.get(b.id) ?? 0) - (fanIn.get(a.id) ?? 0))
  const entryPoints = [
    ...(byLoc[0] ? [{ path: byLoc[0].id, reason: `最大模块 (${byLoc[0].loc} LOC)` }] : []),
    ...(byFanIn[0] && byFanIn[0].id !== byLoc[0]?.id ? [{ path: byFanIn[0].id, reason: `被 ${fanIn.get(byFanIn[0].id) ?? 0} 个模块依赖` }] : []),
    ...(byLoc[1] && byLoc[1].id !== byFanIn[0]?.id ? [{ path: byLoc[1].id, reason: `${byLoc[1].loc} LOC` }] : [])
  ].slice(0, 3)

  // Git hotspots: modules with most commits in recent history.
  const now = Date.now()
  const moduleCommits = new Map<string, { count: number; authors: Set<string> }>()
  for (const c of input.commits) {
    for (const f of c.files) {
      const mod = f.split('/').slice(0, -1).join('/')
      if (!mod) continue
      const entry = moduleCommits.get(mod) ?? { count: 0, authors: new Set() }
      entry.count++
      entry.authors.add(c.author)
      moduleCommits.set(mod, entry)
    }
  }
  const hotspots = [...moduleCommits.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 3)
    .map(([module, { count, authors }]) => ({ module, commits: count, authors: [...authors] }))

  // Stale modules: not touched recently but heavily depended on.
  const moduleLastTouch = new Map<string, number>()
  for (const c of input.commits) {
    for (const f of c.files) {
      const mod = f.split('/').slice(0, -1).join('/')
      if (!mod) continue
      moduleLastTouch.set(mod, Math.max(moduleLastTouch.get(mod) ?? 0, c.at * 1000))
    }
  }
  const stale = input.modules
    .filter((m) => {
      const last = moduleLastTouch.get(m.id)
      const deps = fanIn.get(m.id) ?? 0
      return deps >= 3 && (!last || now - last > 60 * 24 * 60 * 60 * 1000)
    })
    .map((m) => ({
      module: m.id,
      daysSinceChange: moduleLastTouch.has(m.id) ? Math.floor((now - moduleLastTouch.get(m.id)!) / (24 * 60 * 60 * 1000)) : 999,
      dependents: fanIn.get(m.id) ?? 0
    }))
    .sort((a, b) => b.dependents - a.dependents)
    .slice(0, 3)

  // Authors.
  const authorMap = new Map<string, number>()
  for (const c of input.commits) authorMap.set(c.author, (authorMap.get(c.author) ?? 0) + 1)
  const authors = [...authorMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, commits]) => ({ name, commits }))

  // Generate the text.
  // Generate a "senior engineer brief" — not data listing, but actionable insights
  const lines: string[] = []

  // Core insight: what IS this project
  lines.push(`**${identity}**，${input.modules.length} 个模块。`)

  // What matters: the entry points (where to start reading)
  if (entryPoints.length > 0) {
    lines.push(`**从这里开始**：${entryPoints.map((e) => `\`${e.path.split('/').pop()}\`（${e.reason}）`).join('、')}`)
  }

  // What's hot: recent activity (who's doing what)
  if (hotspots.length > 0) {
    const who = authors.slice(0, 2).map((a) => a.name).join('、')
    lines.push(`**最近在动**：${hotspots.map((h) => `\`${h.module.split('/').pop()}\``).join('、')} 被频繁修改${who ? `（主要是 ${who}）` : ''}`)
  }

  // What's dangerous: stale but depended-on modules
  if (stale.length > 0) {
    lines.push(`**注意**：${stale.map((s) => `\`${s.module.split('/').pop()}\` 已 ${s.daysSinceChange} 天没人碰，但 ${s.dependents} 个模块依赖它`).join('；')}`)
  }

  return {
    identity,
    stack,
    scale: { files: input.files.length, modules: input.modules.length, deps: input.edges.length },
    entryPoints,
    hotspots,
    stale,
    authors,
    text: lines.join('\n')
  }
}
