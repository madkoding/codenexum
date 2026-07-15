// Paths that must never be sent to the local CodeNexum server, whether for
// indexing (cm_analyze/cm_read_snippet) or generic compression
// (cm_compress_output). These are excluded even though the server only ever
// runs on 127.0.0.1 — the risk is local persistence (SQLite index,
// snippet-cache.json), not network exfiltration.
const DENYLIST_PATTERNS: RegExp[] = [
  /(^|\/)\.env(\..*)?$/,
  /(^|\/)\.aws(\/|$)/,
  /(^|\/)\.ssh(\/|$)/,
  /\.pem$/,
  /\.key$/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)[^/]*credentials[^/]*$/i,
  /(^|\/)cdk\.context\.json$/,
  /(^|\/)cdk\.out(\/|$)/,
]

export function isDenylistedPath(path: string | undefined | null): boolean {
  if (!path) return false
  return DENYLIST_PATTERNS.some((re) => re.test(path))
}
