/**
 * GitHub REST client for dsh-github-intelligence.
 *
 * Anonymous by default; an optional token raises the rate limit. All public
 * methods honor cancellation and are wrapped in a short TTL cache so agents
 * can compose several tools without burning the anonymous budget.
 * @module dsh-github-intelligence/github
 */

export interface GitHubClientOptions {
  /** Optional GitHub token; raises the 60/hour anonymous limit. */
  token?: string
  /** User-Agent header sent with every request. */
  userAgent: string
  /** Request timeout in milliseconds. */
  timeoutMs: number
  /** Maximum characters kept from a release body preview. */
  bodyPreviewChars: number
  /** TTL of the in-memory response cache. */
  cacheTtlMs: number
}

export interface GitHubRelease {
  tagName: string
  name: string | null
  publishedAt: string | null
  prerelease: boolean
  htmlUrl: string
  bodyPreview: string | null
}

export interface GitHubRepo {
  fullName: string
  description: string | null
  homepage: string | null
  stars: number
  forks: number
  openIssues: number
  language: string | null
  license: string | null
  topics: string[]
  defaultBranch: string | null
  archived: boolean
  createdAt: string | null
  updatedAt: string | null
  pushedAt: string | null
  htmlUrl: string
}

export interface GitHubRepoHit {
  fullName: string
  description: string | null
  stars: number
  language: string | null
  updatedAt: string | null
  htmlUrl: string
}

export interface GitHubIssue {
  number: number
  title: string
  state: 'open' | 'closed'
  user: string
  comments: number
  createdAt: string | null
  htmlUrl: string
}

export interface GitHubPull {
  number: number
  title: string
  state: 'open' | 'closed'
  user: string
  createdAt: string | null
  mergedAt: string | null
  htmlUrl: string
}

export interface GitHubContributor {
  login: string
  contributions: number
  avatarUrl: string | null
}

export interface GitHubCommit {
  sha: string
  message: string
  author: string | null
  date: string | null
  htmlUrl: string
}

export interface GitHubNotification {
  id: string
  unread: boolean
  reason: string
  updatedAt: string | null
  lastReadAt: string | null
  repository: {
    fullName: string
    htmlUrl: string
  }
  subject: {
    title: string
    type: string
    apiUrl: string | null
    htmlUrl: string | null
    latestCommentUrl: string | null
  }
}

export interface GitHubCommunityProfile {
  healthPercentage: number
  files: {
    codeOfConduct: boolean
    contributing: boolean
    issueTemplate: boolean
    pullRequestTemplate: boolean
    readme: boolean
    security: boolean
    license: boolean
  }
}

export type IssueState = 'open' | 'closed' | 'all'
export type PullState = 'open' | 'closed' | 'all'

const API_ROOT = 'https://api.github.com'

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function asBoolean(value: unknown): boolean {
  return value === true
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

function preview(value: unknown, maxChars: number): string | null {
  const text = asString(value)
  if (text === null) return null
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`
}

function firstLine(value: unknown): string | null {
  const text = asString(value)
  if (text === null) return null
  const index = text.indexOf('\n')
  return index === -1 ? text : text.slice(0, index)
}

function subjectHtmlUrl(value: unknown): string | null {
  const url = asString(value)
  if (url === null) return null
  const match = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)\/(issues|pulls|discussions|commits)\/([^/?#]+)/.exec(url)
  if (match === null) return null
  const [, owner, repo, surface, id] = match
  const webSurface = surface === 'pulls' ? 'pull' : surface === 'commits' ? 'commit' : surface
  return `https://github.com/${owner}/${repo}/${webSurface}/${id}`
}

/**
 * The GitHub REST client used by every tool in this plugin.
 */
export class GitHubClient {
  private readonly cache = new Map<string, { expires: number; value: unknown }>()

  constructor(private readonly options: GitHubClientOptions) {}

  private withDeadline(signal: AbortSignal): AbortSignal {
    return AbortSignal.any([signal, AbortSignal.timeout(this.options.timeoutMs)])
  }

  private async cached<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const now = Date.now()
    const hit = this.cache.get(key)
    if (hit !== undefined && hit.expires > now) return hit.value as T
    const value = await loader()
    this.cache.set(key, { expires: now + this.options.cacheTtlMs, value })
    return value
  }

  /**
   * Raw cached request used by generated catalog tools.
   * @param path - API path (starting with /).
   * @param signal - caller cancellation signal.
   * @param cacheKey - optional cache key; defaults to the path.
   */
  raw<T>(path: string, signal: AbortSignal, cacheKey?: string): Promise<T> {
    const key = cacheKey ?? path
    return this.cached(key, () => this.request<T>(path, signal))
  }

  private async request<T>(path: string, signal: AbortSignal): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'user-agent': this.options.userAgent,
    }
    if (this.options.token !== undefined) headers.authorization = `Bearer ${this.options.token}`

    let response: Response
    try {
      response = await fetch(`${API_ROOT}${path}`, { headers, signal: this.withDeadline(signal) })
    } catch (error: unknown) {
      if (signal.aborted) throw new Error('GitHub request cancelled')
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new Error(`GitHub request timed out after ${this.options.timeoutMs}ms`)
      }
      throw new Error(`GitHub network request failed: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (!response.ok) {
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        throw new Error(
          'GitHub API rate limit exceeded (60 requests/hour without a token). '
          + 'Set `githubToken` in the plugin config to raise the limit.',
        )
      }
      if (response.status === 401) {
        throw new Error('GitHub API rejected the configured token (401). Check `githubToken` in the plugin config.')
      }
      if (response.status === 404) {
        throw new Error('GitHub resource not found. Check owner/repo spelling and that the repository is public.')
      }
      if (response.status === 429) {
        throw new Error('GitHub API is rate limiting this request (429). Wait a moment and retry, or configure `githubToken`.')
      }
      throw new Error(`GitHub API error ${response.status} for ${path}`)
    }
    return await response.json() as T
  }

  private encode(owner: string, repo: string): string {
    return `${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`
  }

  getRepo(owner: string, repo: string, signal: AbortSignal): Promise<GitHubRepo> {
    const path = `/repos/${this.encode(owner, repo)}`
    return this.cached(`repo:${path}`, async () => this.parseRepo(await this.request<unknown>(path, signal)))
  }

  listReleases(owner: string, repo: string, limit: number, signal: AbortSignal): Promise<GitHubRelease[]> {
    const perPage = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const path = `/repos/${this.encode(owner, repo)}/releases?per_page=${perPage}`
    return this.cached(`releases:${path}`, async () => {
      const data = await this.request<unknown[]>(path, signal)
      return data.map((entry) => this.parseRelease(entry))
    })
  }

  searchRepos(query: string, limit: number, sort: 'stars' | 'updated', signal: AbortSignal): Promise<GitHubRepoHit[]> {
    const perPage = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const path = `/search/repositories?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=${perPage}`
    return this.cached(`search:${path}`, async () => {
      const data = await this.request<{ items?: unknown }>(path, signal)
      const items = Array.isArray(data.items) ? data.items : []
      return items.map((entry) => this.parseRepoHit(entry))
    })
  }

  /** List a user's own repositories sorted by stars (forks excluded by default). */
  listUserRepos(username: string, limit: number, signal: AbortSignal): Promise<GitHubRepoHit[]> {
    const perPage = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const path = `/users/${encodeURIComponent(username)}/repos?type=owner&sort=stars&order=desc&per_page=${perPage}`
    return this.cached(`user-repos:${path}`, async () => {
      const data = await this.request<unknown[]>(path, signal)
      return data.map((entry) => this.parseRepoHit(entry))
    })
  }

  /** Approximate "trending": repositories created recently, sorted by stars. */
  trending(limit: number, language: string | undefined, sinceDays: number, signal: AbortSignal): Promise<GitHubRepoHit[]> {
    const perPage = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const since = new Date(Date.now() - sinceDays * 86_400_000).toISOString().slice(0, 10)
    let query = `created:>${since}`
    if (language !== undefined && language.trim() !== '') query += ` language:${language.trim()}`
    return this.searchRepos(query, perPage, 'stars', signal)
  }

  listIssues(owner: string, repo: string, state: IssueState, limit: number, signal: AbortSignal): Promise<GitHubIssue[]> {
    const perPage = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const path = `/repos/${this.encode(owner, repo)}/issues?state=${state}&sort=created&direction=desc&per_page=${perPage}`
    return this.cached(`issues:${path}`, async () => {
      const data = await this.request<unknown[]>(path, signal)
      // The issues endpoint also returns pull requests; they carry a `pull_request` key.
      return data
        .filter((entry) => (entry as Record<string, unknown>).pull_request === undefined)
        .map((entry) => this.parseIssue(entry))
    })
  }

  listPulls(owner: string, repo: string, state: PullState, limit: number, signal: AbortSignal): Promise<GitHubPull[]> {
    const perPage = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const path = `/repos/${this.encode(owner, repo)}/pulls?state=${state}&sort=created&direction=desc&per_page=${perPage}`
    return this.cached(`pulls:${path}`, async () => {
      const data = await this.request<unknown[]>(path, signal)
      return data.map((entry) => this.parsePull(entry))
    })
  }

  listContributors(owner: string, repo: string, limit: number, signal: AbortSignal): Promise<GitHubContributor[]> {
    const perPage = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const path = `/repos/${this.encode(owner, repo)}/contributors?per_page=${perPage}`
    return this.cached(`contributors:${path}`, async () => {
      const data = await this.request<unknown[]>(path, signal)
      return data.map((entry) => this.parseContributor(entry))
    })
  }

  recentCommits(owner: string, repo: string, limit: number, signal: AbortSignal): Promise<GitHubCommit[]> {
    const perPage = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const path = `/repos/${this.encode(owner, repo)}/commits?per_page=${perPage}`
    return this.cached(`commits:${path}`, async () => {
      const data = await this.request<unknown[]>(path, signal)
      return data.map((entry) => this.parseCommit(entry))
    })
  }

  /** Repository community-health files and GitHub's own health percentage. */
  getCommunityProfile(owner: string, repo: string, signal: AbortSignal): Promise<GitHubCommunityProfile> {
    const path = `/repos/${this.encode(owner, repo)}/community/profile`
    return this.cached(`community:${path}`, async () => {
      const raw = await this.request<Record<string, unknown>>(path, signal)
      const files = raw.files !== null && typeof raw.files === 'object'
        ? raw.files as Record<string, unknown>
        : {}
      const present = (key: string): boolean => files[key] !== null && files[key] !== undefined
      return {
        healthPercentage: Math.min(Math.max(asNumber(raw.health_percentage), 0), 100),
        files: {
          codeOfConduct: present('code_of_conduct') || present('code_of_conduct_file'),
          contributing: present('contributing'),
          issueTemplate: present('issue_template'),
          pullRequestTemplate: present('pull_request_template'),
          readme: present('readme'),
          security: present('security'),
          license: present('license'),
        },
      }
    })
  }

  /** Authenticated notification inbox, exposed as a read-only maintainer queue. */
  async listNotifications(
    all: boolean,
    participating: boolean,
    limit: number,
    signal: AbortSignal,
  ): Promise<GitHubNotification[]> {
    if (this.options.token === undefined || this.options.token === '') {
      throw new Error(
        'github-intelligence: github_notifications requires `githubToken` with notification read access.',
      )
    }
    const perPage = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const path = `/notifications?all=${all}&participating=${participating}&per_page=${perPage}`
    return await this.cached(`notifications:${path}`, async () => {
      const data = await this.request<unknown[]>(path, signal)
      return data.map((entry) => this.parseNotification(entry))
    })
  }

  private parseRelease(entry: unknown): GitHubRelease {
    const raw = entry as Record<string, unknown>
    return {
      tagName: asString(raw.tag_name) ?? 'unknown',
      name: asString(raw.name),
      publishedAt: asString(raw.published_at),
      prerelease: asBoolean(raw.prerelease),
      htmlUrl: asString(raw.html_url) ?? '',
      bodyPreview: preview(raw.body, this.options.bodyPreviewChars),
    }
  }

  private parseRepo(entry: unknown): GitHubRepo {
    const raw = entry as Record<string, unknown>
    const license = raw.license as Record<string, unknown> | null
    return {
      fullName: asString(raw.full_name) ?? 'unknown',
      description: asString(raw.description),
      homepage: asString(raw.homepage),
      stars: asNumber(raw.stargazers_count),
      forks: asNumber(raw.forks_count),
      openIssues: asNumber(raw.open_issues_count),
      language: asString(raw.language),
      license: license !== null && typeof license === 'object' ? asString(license.spdx_id) : null,
      topics: asStringArray(raw.topics),
      defaultBranch: asString(raw.default_branch),
      archived: asBoolean(raw.archived),
      createdAt: asString(raw.created_at),
      updatedAt: asString(raw.updated_at),
      pushedAt: asString(raw.pushed_at),
      htmlUrl: asString(raw.html_url) ?? '',
    }
  }

  private parseRepoHit(entry: unknown): GitHubRepoHit {
    const raw = entry as Record<string, unknown>
    return {
      fullName: asString(raw.full_name) ?? 'unknown',
      description: asString(raw.description),
      stars: asNumber(raw.stargazers_count),
      language: asString(raw.language),
      updatedAt: asString(raw.updated_at),
      htmlUrl: asString(raw.html_url) ?? '',
    }
  }

  private parseIssue(entry: unknown): GitHubIssue {
    const raw = entry as Record<string, unknown>
    const user = raw.user as Record<string, unknown> | null
    return {
      number: asNumber(raw.number),
      title: asString(raw.title) ?? 'untitled',
      state: raw.state === 'closed' ? 'closed' : 'open',
      user: user !== null && typeof user === 'object' ? asString(user.login) ?? 'unknown' : 'unknown',
      comments: asNumber(raw.comments),
      createdAt: asString(raw.created_at),
      htmlUrl: asString(raw.html_url) ?? '',
    }
  }

  private parsePull(entry: unknown): GitHubPull {
    const raw = entry as Record<string, unknown>
    const user = raw.user as Record<string, unknown> | null
    return {
      number: asNumber(raw.number),
      title: asString(raw.title) ?? 'untitled',
      state: raw.state === 'closed' ? 'closed' : 'open',
      user: user !== null && typeof user === 'object' ? asString(user.login) ?? 'unknown' : 'unknown',
      createdAt: asString(raw.created_at),
      mergedAt: asString(raw.merged_at),
      htmlUrl: asString(raw.html_url) ?? '',
    }
  }

  private parseContributor(entry: unknown): GitHubContributor {
    const raw = entry as Record<string, unknown>
    return {
      login: asString(raw.login) ?? 'unknown',
      contributions: asNumber(raw.contributions),
      avatarUrl: asString(raw.avatar_url),
    }
  }

  private parseCommit(entry: unknown): GitHubCommit {
    const raw = entry as Record<string, unknown>
    const commit = raw.commit as Record<string, unknown> | null
    const author = commit !== null && typeof commit === 'object'
      ? commit.author as Record<string, unknown> | null
      : null
    return {
      sha: asString(raw.sha) ?? '',
      message: firstLine(commit !== null && typeof commit === 'object' ? commit.message : null) ?? '',
      author: author !== null && typeof author === 'object' ? asString(author.name) : null,
      date: author !== null && typeof author === 'object' ? asString(author.date) : null,
      htmlUrl: asString(raw.html_url) ?? '',
    }
  }

  private parseNotification(entry: unknown): GitHubNotification {
    const raw = entry as Record<string, unknown>
    const repository = raw.repository !== null && typeof raw.repository === 'object'
      ? raw.repository as Record<string, unknown>
      : {}
    const subject = raw.subject !== null && typeof raw.subject === 'object'
      ? raw.subject as Record<string, unknown>
      : {}
    return {
      id: asString(raw.id) ?? '',
      unread: asBoolean(raw.unread),
      reason: asString(raw.reason) ?? 'unknown',
      updatedAt: asString(raw.updated_at),
      lastReadAt: asString(raw.last_read_at),
      repository: {
        fullName: asString(repository.full_name) ?? 'unknown',
        htmlUrl: asString(repository.html_url) ?? '',
      },
      subject: {
        title: asString(subject.title) ?? 'untitled',
        type: asString(subject.type) ?? 'unknown',
        apiUrl: asString(subject.url),
        htmlUrl: subjectHtmlUrl(subject.url),
        latestCommentUrl: asString(subject.latest_comment_url),
      },
    }
  }
}
