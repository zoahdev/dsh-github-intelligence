/**
 * ArXiv search over the public Atom API (no key, no auth).
 *
 * Kept dependency-free: a small, strict Atom parser extracts entries, and a
 * short TTL cache keeps repeated research queries cheap.
 * @module dsh-github-intelligence/arxiv
 */

export interface ArxivEntry {
  id: string
  title: string
  summary: string
  published: string
  updated: string
  authors: string[]
  link: string
}

export interface ArxivSearchOptions {
  query: string
  maxResults: number
  signal: AbortSignal
  timeoutMs: number
  cacheTtlMs: number
  userAgent: string
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function tagOf(block: string, name: string): string {
  const match = new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block)
  return match !== null && match[1] !== undefined ? match[1].trim() : ''
}

/** Parse an ArXiv Atom response into plain entries. */
export function parseArxivAtom(xml: string): ArxivEntry[] {
  const out: ArxivEntry[] = []
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g
  let match: RegExpExecArray | null
  while ((match = entryRe.exec(xml)) !== null) {
    const block = match[1] ?? ''
    const authors = [...block.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/g)]
      .map((m) => decodeEntities((m[1] ?? '').trim()))
      .filter((name) => name !== '')
    const linkMatch = /<link[^>]*href="([^"]+)"[^>]*\/?>/.exec(block)
    out.push({
      id: decodeEntities(tagOf(block, 'id')),
      title: decodeEntities(tagOf(block, 'title')),
      summary: decodeEntities(tagOf(block, 'summary')).replace(/\s+/g, ' ').trim(),
      published: tagOf(block, 'published'),
      updated: tagOf(block, 'updated'),
      authors,
      link: linkMatch !== null && linkMatch[1] !== undefined ? linkMatch[1] : '',
    })
  }
  return out
}

const cache = new Map<string, { expires: number; value: ArxivEntry[] }>()

/** Search ArXiv and return parsed entries (short TTL cache, cancellable). */
export async function searchArxiv(options: ArxivSearchOptions): Promise<ArxivEntry[]> {
  const key = `${options.query}\u0000${options.maxResults}`
  const now = Date.now()
  const hit = cache.get(key)
  if (hit !== undefined && hit.expires > now) return hit.value

  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(options.query)}`
    + `&start=0&max_results=${options.maxResults}&sortBy=relevance`
  const deadline = AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
  let response: Response
  try {
    response = await fetch(url, {
      headers: { 'user-agent': options.userAgent, accept: 'application/atom+xml' },
      signal: deadline,
    })
  } catch (error: unknown) {
    if (options.signal.aborted) throw new Error('Request cancelled')
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new Error(`ArXiv request timed out after ${options.timeoutMs}ms`)
    }
    throw new Error(`ArXiv request failed: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    if (response.status === 429) throw new Error('ArXiv rate limited (HTTP 429). Retry later.')
    throw new Error(`ArXiv request failed (HTTP ${response.status})`)
  }
  const entries = parseArxivAtom(await response.text())
  cache.set(key, { expires: now + options.cacheTtlMs, value: entries })
  return entries
}
