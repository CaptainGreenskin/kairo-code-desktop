/**
 * Secret read-guard. The write side is gated by protected globs, but an
 * autonomous agent can still READ .env / credentials / private keys and leak
 * their values into the model context (and from there, anywhere). This redacts
 * secret values when the agent reads a secret-bearing file (and strips obvious
 * key material / tokens anywhere), so the agent sees structure, not secrets.
 * Pure + browser-safe. Redaction over hard-blocking keeps legit use working.
 */

/** Filenames / path fragments that denote secret-bearing files. */
const SECRET_PATH_RE =
  /(^|\/)(\.env(\.[\w.-]+)?|\.npmrc|\.netrc|\.pgpass|credentials(\.\w+)?|secrets?(\.\w+)?|id_rsa|id_ed25519|id_dsa|id_ecdsa)$|\.(pem|key|p12|pfx|keystore|jks)$|(^|\/)\.ssh\//i

/** Is this path a secret-bearing file whose contents should be redacted? */
export function isSecretPath(filePath: string): boolean {
  return SECRET_PATH_RE.test(filePath.replace(/\\/g, '/'))
}

const PRIVATE_KEY_BLOCK = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g
// KEY=VALUE / KEY: VALUE where the key name looks sensitive.
const SENSITIVE_ASSIGN =
  /(\b[\w.-]*(?:secret|token|password|passwd|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential|auth|client[_-]?secret)[\w.-]*\s*[:=]\s*)(['"]?)([^\s'"#]+)\2/gi
// Well-known token shapes (provider prefixes + AWS access key ids).
const KNOWN_TOKENS =
  /\b(AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{20,})\b/g

/** Redact private keys, sensitive assignments and known token shapes. */
export function redactSecrets(content: string): string {
  if (!content) return content
  return content
    .replace(PRIVATE_KEY_BLOCK, '[REDACTED PRIVATE KEY]')
    .replace(SENSITIVE_ASSIGN, (_m, prefix: string, q: string, _v: string) => `${prefix}${q}[REDACTED]${q}`)
    .replace(KNOWN_TOKENS, '[REDACTED]')
}

/**
 * Guard a file read: secret files get fully redacted with a banner; other files
 * still get obvious key material / tokens stripped (cheap, low false-positive).
 */
export function guardFileContent(filePath: string, content: string): string {
  if (isSecretPath(filePath)) {
    return `# ⚠️ 该文件被识别为密钥/凭证文件，敏感值已脱敏（防止泄漏到模型上下文）\n${redactSecrets(content)}`
  }
  return redactSecrets(content)
}
