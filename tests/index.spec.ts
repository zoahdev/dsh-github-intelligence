import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, Config, defineTools } from '../src/index.js'

function resolvedConfig(overrides: Record<string, unknown> = {}) {
  return {
    githubToken: undefined,
    timeoutMs: 5_000,
    defaultLimit: 3,
    bodyPreviewChars: 20,
    cacheTtlMs: 60_000,
    userAgent: 'test-agent',
    ...overrides,
  }
}

function jsonResponse(body: unknown, init: Partial<Response> = {}) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(),
    json: async () => body,
    ...init,
  } as Response
}

function exec() {
  return { signal: new AbortController().signal } as never
}

function repoBody() {
  return {
    full_name: 'x/y',
    description: 'd',
    homepage: null,
    stargazers_count: 5,
    forks_count: 1,
    open_issues_count: 2,
    language: 'TS',
    license: { spdx_id: 'MIT' },
    topics: ['t'],
    default_branch: 'main',
    archived: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-02-01T00:00:00Z',
    pushed_at: '2026-03-01T00:00:00Z',
    html_url: 'https://github.com/x/y',
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('plugin registration', () => {
  it('registers 100+ tools (flagship + catalog + help)', () => {
    const registered: unknown[] = []
    const ctx = { tools: { register: (tool: unknown) => { registered.push(tool) } } } as never
    apply(ctx, resolvedConfig())
    expect(registered.length).toBeGreaterThanOrEqual(100)
  })

  it('rejects non-positive integer configuration', () => {
    const ctx = { tools: { register: vi.fn() } } as never
    expect(() => apply(ctx, resolvedConfig({ cacheTtlMs: 0 }))).toThrow('positive integer')
  })

  it('exports a schemastery Config schema', () => {
    expect(Config).toBeDefined()
  })
})

describe('github_repo tool', () => {
  it('returns the extended overview', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(repoBody())))
    const [repo] = defineTools(resolvedConfig())
    const result = await repo.execute({ owner: 'x', repo: 'y' }, exec())
    expect(result).toMatchObject({ fullName: 'x/y', stars: 5, topics: ['t'], defaultBranch: 'main' })
  })
})

describe('github_weekly_digest tool', () => {
  it('filters activity to the requested look-back window', async () => {
    const now = Date.now()
    const fresh = (offsetDays: number): string => new Date(now - offsetDays * 86_400_000).toISOString()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/releases?')) {
        return jsonResponse([{ tag_name: 'v1', name: null, published_at: fresh(2), prerelease: false, html_url: 'https://x/r' }])
      }
      if (u.includes('/pulls?')) {
        return jsonResponse([{ number: 1, title: 'p', state: 'closed', user: { login: 'u' }, created_at: fresh(10), merged_at: fresh(3), html_url: 'https://x/p' }])
      }
      if (u.includes('/issues?')) {
        return jsonResponse([{ number: 2, title: 'i', state: 'open', user: { login: 'u' }, comments: 0, created_at: fresh(4), html_url: 'https://x/i' }])
      }
      if (u.includes('/commits?')) {
        return jsonResponse([{ sha: 'abc', commit: { message: 'm', author: { name: 'u', date: fresh(5) } }, html_url: 'https://x/c' }])
      }
      return jsonResponse([])
    }))
    const tools = defineTools(resolvedConfig()) as unknown as Array<{
      name: string
      execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<Record<string, unknown>>
    }>
    const digest = tools.find((tool) => tool.name === 'github_weekly_digest')
    expect(digest).toBeDefined()
    const week = await digest!.execute({ owner: 'x', repo: 'y', days: 7 }, exec())
    expect(week.releases).toHaveLength(1)
    expect(week.mergedPulls).toHaveLength(1)
    expect(week.newIssues).toHaveLength(1)
    expect(week.commits).toHaveLength(1)
    const day = await digest!.execute({ owner: 'x', repo: 'y', days: 1 }, exec())
    expect(day.releases).toHaveLength(0)
    expect(day.mergedPulls).toHaveLength(0)
    expect(day.newIssues).toHaveLength(0)
    expect(day.commits).toHaveLength(0)
  })

  it('tolerates a 404 on one surface (e.g. pull requests disabled)', async () => {
    const now = Date.now()
    const fresh = (offsetDays: number): string => new Date(now - offsetDays * 86_400_000).toISOString()
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/pulls?')) return { ok: false, status: 404, json: async () => ({}) } as Response
      if (u.includes('/releases?')) {
        return jsonResponse([{ tag_name: 'v1', name: null, published_at: fresh(2), prerelease: false, html_url: 'https://x/r' }])
      }
      if (u.includes('/issues?')) return jsonResponse([])
      if (u.includes('/commits?')) return jsonResponse([])
      return jsonResponse([])
    }))
    const tools = defineTools(resolvedConfig()) as unknown as Array<{
      name: string
      execute: (args: Record<string, unknown>, exec: { signal: AbortSignal }) => Promise<Record<string, unknown>>
    }>
    const digest = tools.find((tool) => tool.name === 'github_weekly_digest')
    const result = await digest!.execute({ owner: 'x', repo: 'y', days: 7 }, exec())
    expect(result.mergedPulls).toEqual([])
    expect(result.releases).toHaveLength(1)
  })
})

describe('github_issues tool', () => {
  it('lists open issues by default', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([
      { number: 1, title: 'i', state: 'open', user: { login: 'u' }, comments: 0, created_at: '2026-01-01T00:00:00Z', html_url: 'u' },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const [, , , issues] = defineTools(resolvedConfig())
    const result = await issues.execute({ owner: 'x', repo: 'y' }, exec())
    expect(fetchMock.mock.calls[0]?.[0]).toContain('state=open')
    expect(result).toMatchObject({ state: 'open', issues: [{ number: 1, title: 'i' }] })
  })
})

describe('github_repo_report tool', () => {
  it('composes overview, latest release, commits, and contributors', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('/releases')) return jsonResponse([
        { tag_name: 'v2', published_at: '2026-08-01T00:00:00Z', prerelease: false, html_url: 'r', body: 'b' },
      ])
      if (u.includes('/commits')) return jsonResponse([
        { sha: 'abc', commit: { message: 'feat: x', author: { name: 'Zo', date: '2026-08-01T00:00:00Z' } }, html_url: 'c' },
      ])
      if (u.includes('/contributors')) return jsonResponse([
        { login: 'z', contributions: 10, avatar_url: 'a' },
      ])
      return jsonResponse(repoBody())
    })
    vi.stubGlobal('fetch', fetchMock)

    const [, , , , , , report] = defineTools(resolvedConfig())
    const result = await report.execute({ owner: 'x', repo: 'y' }, exec())

    expect(result).toMatchObject({
      fullName: 'x/y',
      overview: { fullName: 'x/y', stars: 5 },
      latestRelease: { tagName: 'v2' },
      openIssues: 2,
      recentCommits: [{ sha: 'abc', message: 'feat: x' }],
      topContributors: [{ login: 'z', contributions: 10 }],
    })
    // repo + releases + commits + contributors = 4 distinct requests
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})

describe('input validation', () => {
  it('rejects empty owner or repo', async () => {
    const [repo] = defineTools(resolvedConfig())
    await expect(repo.execute({ owner: ' ', repo: 'y' }, exec())).rejects.toThrow('non-empty')
  })

  it('rejects an empty search query', async () => {
    const [, , search] = defineTools(resolvedConfig())
    await expect(search.execute({ query: '  ' }, exec())).rejects.toThrow('non-empty')
  })
})

describe('github_compare tool', () => {
  it('compares two repositories and reuses the cache on a second call', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(repoBody()))
    vi.stubGlobal('fetch', fetchMock)
    const tools = defineTools(resolvedConfig())
    const compare = tools[7]

    const result = await compare.execute({ ownerA: 'x', repoA: 'y', ownerB: 'z', repoB: 'w' }, exec())
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toMatchObject({
      first: { fullName: 'x/y', stars: 5 },
      second: { fullName: 'x/y', stars: 5 },
      deltas: { stars: 0, forks: 0, openIssues: 0 },
    })

    await compare.execute({ ownerA: 'x', repoA: 'y', ownerB: 'z', repoB: 'w' }, exec())
    expect(fetchMock).toHaveBeenCalledTimes(2) // cached
  })
})

describe('github_trending tool', () => {
  it('builds a created-after query and optional language filter', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const trending = defineTools(resolvedConfig())[8]
    await trending.execute({ limit: 3, language: 'TypeScript', sinceDays: 7 }, exec())
    const url = String(fetchMock.mock.calls[0]?.[0])
    expect(url).toContain('created%3A%3E')
    expect(url).toContain('language%3ATypeScript')
    expect(url).toContain('sort=stars')
  })
})

describe('github_user_repos tool', () => {
  it('lists a user\'s repositories sorted by stars', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([
      { full_name: 'u/big', description: 'd', stargazers_count: 99, language: 'TS', updated_at: '2026-01-01T00:00:00Z', html_url: 'u' },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const userRepos = defineTools(resolvedConfig())[9]
    const result = await userRepos.execute({ username: 'deepseek-ai' }, exec())
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/users/deepseek-ai/repos?type=owner&sort=stars')
    expect(result).toMatchObject({ username: 'deepseek-ai', repos: [{ fullName: 'u/big', stars: 99 }] })
  })
})
