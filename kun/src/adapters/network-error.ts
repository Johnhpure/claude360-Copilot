/**
 * Node's fetch reports every network failure as a bare `TypeError: fetch
 * failed`, hiding the actionable detail (DNS, refused connection, TLS, …)
 * in the `cause` chain. Flatten that chain into one readable message.
 */
export function describeNetworkError(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (current instanceof AggregateError && current.errors.length > 0) {
      current = current.errors[0]
      continue
    }
    if (!(current instanceof Error)) {
      parts.push(String(current))
      break
    }
    const code = (current as { code?: unknown }).code
    const codeText = typeof code === 'string' ? code : ''
    const message = current.message.trim()
    if (message) {
      parts.push(codeText && !message.includes(codeText) ? `${message} (${codeText})` : message)
    } else if (codeText) {
      parts.push(codeText)
    }
    current = current.cause
  }
  const unique = parts.filter((part, index) => parts.indexOf(part) === index)
  return unique.join(': ') || 'unknown network error'
}

export type ModelFetchErrorClass = {
  /** Stable machine-readable classification consumed by the GUI. */
  code: 'model_fetch_dns_failed' | 'model_fetch_connect_failed' | 'model_fetch_tls_failed' | 'model_fetch_failed'
  /** Flattened cause-chain text from `describeNetworkError`. */
  detail: string
  /** True only when the request provably never reached the server. */
  retriable: boolean
}

// errno / undici / OpenSSL codes matched case-insensitively against every
// code and message collected along the cause chain (including all
// AggregateError members, e.g. Happy Eyeballs multi-address failures).
const DNS_FAILURE_PATTERN = /\b(?:ENOTFOUND|EAI_AGAIN)\b/
const CONNECT_FAILURE_PATTERN = /\b(?:ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|UND_ERR_CONNECT_TIMEOUT)\b/
const TLS_FAILURE_PATTERN =
  /\b(?:UNABLE_TO_VERIFY_LEAF_SIGNATURE|SELF_SIGNED_CERT_IN_CHAIN|DEPTH_ZERO_SELF_SIGNED_CERT|CERT_[A-Z0-9_]+|ERR_TLS_[A-Z0-9_]+|EPROTO)\b/

function collectErrorTokens(error: unknown, depth: number, out: string[]): void {
  if (depth >= 6 || error == null) return
  if (error instanceof AggregateError) {
    if (error.message.trim()) out.push(error.message)
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') out.push(code)
    for (const inner of error.errors.slice(0, 5)) collectErrorTokens(inner, depth + 1, out)
    return
  }
  if (!(error instanceof Error)) {
    out.push(String(error))
    return
  }
  const code = (error as { code?: unknown }).code
  if (typeof code === 'string') out.push(code)
  if (error.message.trim()) out.push(error.message)
  collectErrorTokens(error.cause, depth + 1, out)
}

/**
 * Classify a model-request transport failure by the errno / undici codes
 * buried in its cause chain. Only failures that happen strictly before the
 * request reaches the server (DNS resolution, TCP connect) are retriable.
 * TLS failures are configuration errors worth failing fast on, and
 * reset/socket errors may have already delivered the request body, so
 * re-POSTing those risks duplicate generations.
 */
export function classifyModelFetchError(error: unknown): ModelFetchErrorClass {
  const detail = describeNetworkError(error)
  const tokens: string[] = []
  collectErrorTokens(error, 0, tokens)
  const haystack = tokens.join(' ').toUpperCase()
  if (DNS_FAILURE_PATTERN.test(haystack)) {
    return { code: 'model_fetch_dns_failed', detail, retriable: true }
  }
  if (CONNECT_FAILURE_PATTERN.test(haystack)) {
    return { code: 'model_fetch_connect_failed', detail, retriable: true }
  }
  if (TLS_FAILURE_PATTERN.test(haystack)) {
    return { code: 'model_fetch_tls_failed', detail, retriable: false }
  }
  return { code: 'model_fetch_failed', detail, retriable: false }
}
