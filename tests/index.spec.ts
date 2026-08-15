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
  it('registers exactly seven tools', () => {
    const registered: unknown[] = []
    const ctx = { tools: { register: (tool: unknown) => { registered.push(tool) } } } as never
    apply(ctx, resolvedConfig())
    expect(registered).toHaveLength(7)
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
