/**
 * Lazy shiki highlighter singleton.
 *
 * Loading shiki's full bundle on every code block is expensive. We boot a
 * single highlighter on first call and reuse it for the lifetime of the
 * renderer. Languages are loaded on demand and cached.
 */

import {
  createHighlighter,
  type Highlighter,
  type BundledLanguage,
  type BundledTheme
} from 'shiki'

const DARK_THEME: BundledTheme = 'github-dark'
const LIGHT_THEME: BundledTheme = 'github-light'
let currentTheme: BundledTheme = DARK_THEME

// Pre-load a few common languages so first-paint is fast for the workloads
// users hit most often. Anything outside this set is loaded lazily below.
const PRELOADED_LANGS: BundledLanguage[] = [
  'typescript',
  'javascript',
  'tsx',
  'jsx',
  'json',
  'bash',
  'shell',
  'python',
  'markdown',
  'yaml',
  'html',
  'css'
]

let highlighterPromise: Promise<Highlighter> | null = null
const loadedLangs = new Set<string>(PRELOADED_LANGS)

export function setHighlighterTheme(theme: string): void {
  currentTheme = theme === 'light' ? LIGHT_THEME : DARK_THEME
}

async function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [DARK_THEME, LIGHT_THEME],
      langs: PRELOADED_LANGS
    })
  }
  return highlighterPromise
}

/** Best-effort language normalization for incoming markdown fence labels. */
function normalizeLang(lang: string | undefined): BundledLanguage | 'text' {
  if (!lang) return 'text'
  const l = lang.toLowerCase().trim()
  const aliases: Record<string, BundledLanguage> = {
    ts: 'typescript',
    js: 'javascript',
    sh: 'bash',
    zsh: 'bash',
    py: 'python',
    yml: 'yaml',
    md: 'markdown'
  }
  return (aliases[l] ?? (l as BundledLanguage)) || 'text'
}

/**
 * Render a code block to highlighted HTML. Falls back to a plain `<pre>`
 * if the language is not bundled in shiki.
 */
export async function highlight(code: string, lang?: string): Promise<string> {
  const hl = await getHighlighter()
  const language = normalizeLang(lang)

  if (language !== 'text' && !loadedLangs.has(language)) {
    try {
      await hl.loadLanguage(language)
      loadedLangs.add(language)
    } catch {
      // Fall through to plain rendering for unknown languages.
      return escapeHtml(code)
    }
  }

  try {
    return hl.codeToHtml(code, { lang: language, theme: currentTheme })
  } catch {
    return escapeHtml(code)
  }
}

function escapeHtml(s: string): string {
  return `<pre class="shiki"><code>${s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</code></pre>`
}
