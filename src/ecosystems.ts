/**
 * Generic JSON fetch client for non-GitHub ecosystems (npm, PyPI, crates.io,
 * Docker Hub, Hugging Face, Hacker News, Stack Overflow, Reddit, ...).
 * Shares the same cancellation + TTL-cache discipline as the GitHub client.
 * @module dsh-github-intelligence/ecosystems
 */

export interface EcosystemClientOptions {
  userAgent: string
  timeoutMs: number
  cacheTtlMs: number
}

export class EcosystemClient {
  private readonly cache = new Map<string, { expires: number; value: unknown }>()

  constructor(private readonly options: EcosystemClientOptions) {}

  async raw<T>(url: string, signal: AbortSignal, cacheKey?: string): Promise<T> {
    const key = cacheKey ?? url
    const now = Date.now()
    const hit = this.cache.get(key)
    if (hit !== undefined && hit.expires > now) return hit.value as T
    const value = await this.fetchOnce(url, signal)
    this.cache.set(key, { expires: now + this.options.cacheTtlMs, value })
    return value as T
  }

  private async fetchOnce(url: string, signal: AbortSignal): Promise<unknown> {
    const deadline = AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)])
    let response: Response
    try {
      response = await fetch(url, {
        headers: { 'user-agent': this.options.userAgent, accept: 'application/json' },
        signal: deadline,
      })
    } catch (error: unknown) {
      if (signal.aborted) throw new Error('Request cancelled')
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`Request timed out after ${this.options.timeoutMs}ms`)
      }
      throw new Error(`Network request failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (!response.ok) {
      if (response.status === 404) throw new Error(`Not found: ${url}`)
      if (response.status === 429 || response.status === 403) {
        throw new Error(`Rate limited (HTTP ${response.status}) by ${new URL(url).host}. Retry later.`)
      }
      throw new Error(`HTTP ${response.status} from ${new URL(url).host}`)
    }
    return await response.json()
  }
}
