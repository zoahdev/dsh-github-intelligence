import { afterEach, describe, expect, it, vi } from 'vitest'
import { GitHubClient } from '../src/github.js'

const BASE = 'https://api.github.com'

function makeClient(overrides: Partial<ConstructorParameters<typeof GitHubClient>[0]> = {}) {
  return new GitHubClient({
    token: undefined,
    userAgent: 'test-agent',
    timeoutMs: 5_000,
    bodyPreviewChars: 20,
    cacheTtlMs: 60_000,
    ...overrides,
  })
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

function signal() {
  return new AbortController().signal
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GitHubClient', () => {
  it('parses the extended repository overview', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      full_name: 'a/b',
      description: 'd',
      homepage: 'https://example.com',
      stargazers_count: 10,
      forks_count: 2,
      open_issues_count: 3,
      language: 'TypeScript',
      license: { spdx_id: 'MIT' },
      topics: ['agent', 'ai'],
      default_branch: 'main',
      archived: false,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-02-01T00:00:00Z',
      pushed_at: '2026-03-01T00:00:00Z',
      html_url: 'https://github.com/a/b',
    })))

    const repo = await makeClient().getRepo('a', 'b', signal())
    expect(repo).toMatchObject({
      fullName: 'a/b',
      homepage: 'https://example.com',
      topics: ['agent', 'ai'],
      defaultBranch: 'main',
      archived: false,
      createdAt: '2026-01-01T00:00:00Z',
      pushedAt: '2026-03-01T00:00:00Z',
    })
  })

  it('caches identical requests within the TTL', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ full_name: 'a/b', stargazers_count: 1, forks_count: 0, open_issues_count: 0, html_url: '' }))
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient()
    await client.getRepo('a', 'b', signal())
    await client.getRepo('a', 'b', signal())
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('lists releases with a bounded body preview', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { tag_name: 'v1', published_at: '2026-08-01T00:00:00Z', prerelease: false, html_url: 'u', body: 'x'.repeat(100) },
    ])))
    const releases = await makeClient().listReleases('a', 'b', 5, signal())
    expect(releases[0]?.bodyPreview?.length).toBe(21)
  })

  it('filters pull requests out of the issues endpoint', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([
      { number: 1, title: 'issue', state: 'open', user: { login: 'u1' }, comments: 0, created_at: '2026-01-01T00:00:00Z', html_url: 'i' },
      { number: 2, title: 'pr', state: 'open', user: { login: 'u2' }, comments: 0, created_at: '2026-01-01T00:00:00Z', html_url: 'p', pull_request: {} },
    ]))
    vi.stubGlobal('fetch', fetchMock)

    const issues = await makeClient().listIssues('a', 'b', 'open', 5, signal())
    expect(fetchMock.mock.calls[0]?.[0]).toContain('state=open')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ number: 1, title: 'issue', user: 'u1' })
  })

  it('maps pull requests', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse([
      { number: 7, title: 'fix', state: 'closed', user: { login: 'u' }, created_at: '2026-01-01T00:00:00Z', merged_at: '2026-01-02T00:00:00Z', html_url: 'p' },
    ])))
    const pulls = await makeClient().listPulls('a', 'b', 'closed', 5, signal())
    expect(pulls[0]).toMatchObject({ number: 7, state: 'closed', mergedAt: '2026-01-02T00:00:00Z' })
  })

  it('maps contributors and recent commits', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes('/contributors')) {
        return jsonResponse([{ login: 'z', contributions: 99, avatar_url: 'av' }])
      }
      return jsonResponse([{ sha: 'abc123', commit: { message: 'fix: thing\n\ndetails', author: { name: 'Zo', date: '2026-08-01T00:00:00Z' } }, html_url: 'c' }])
    })
    vi.stubGlobal('fetch', fetchMock)
    const client = makeClient()
    const contributors = await client.listContributors('a', 'b', 5, signal())
    const commits = await client.recentCommits('a', 'b', 5, signal())
    expect(contributors[0]).toMatchObject({ login: 'z', contributions: 99, avatarUrl: 'av' })
    expect(commits[0]).toMatchObject({ sha: 'abc123', message: 'fix: thing', author: 'Zo' })
  })

  it('reports anonymous rate-limit hits with actionable guidance', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'limited' }, {
      ok: false,
      status: 403,
      headers: new Headers({ 'x-ratelimit-remaining': '0' }),
    })))
    await expect(makeClient().getRepo('a', 'b', signal())).rejects.toThrow('rate limit')
  })

  it('reports missing repositories clearly', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ message: 'Not Found' }, {
      ok: false,
      status: 404,
      headers: new Headers(),
    })))
    await expect(makeClient().getRepo('a', 'b', signal())).rejects.toThrow('not found')
  })
})
