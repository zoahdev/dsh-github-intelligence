/**
 * dsh-github-intelligence — the most complete GitHub integration for
 * DeepSeek Harness.
 *
 * 201 read-only tools across 16 developer ecosystems (GitHub, GitLab,
 * Gitee, npm, PyPI, crates.io, Docker Hub, Hugging Face, Hacker News,
 * Stack Overflow, Reddit, dev.to, RubyGems, NuGet, the Go module proxy, and
 * ArXiv), plus the dsh plugin registry. Optional token, cancellation, and a
 * short TTL cache keep the anonymous rate budget usable.
 * @module dsh-github-intelligence
 */

import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  GitHubClient,
  type GitHubClientOptions,
  type GitHubCommit,
  type GitHubContributor,
  type GitHubIssue,
  type GitHubPull,
  type GitHubRelease,
  type GitHubRepo,
  type GitHubRepoHit,
} from './github.js'
import { buildCatalogTool, buildHelpTool, catalog, type Fetcher } from './catalog.js'
import { EcosystemClient } from './ecosystems.js'
import { searchArxiv } from './arxiv.js'

export const name = 'github-intelligence'

/** Services required by this plugin. */
export const inject = ['tools']

/** Plugin configuration supplied through cordis.yml. */
export interface Config {
  /** Optional GitHub token; raises the anonymous 60 requests/hour limit. */
  githubToken?: string
  /** Request timeout in milliseconds. Defaults to 10000. */
  timeoutMs?: number
  /** Default result count when the model omits `limit`. Defaults to 5. */
  defaultLimit?: number
  /** Maximum characters kept from a release body preview. Defaults to 500. */
  bodyPreviewChars?: number
  /** Response cache TTL in milliseconds. Defaults to 60000. */
  cacheTtlMs?: number
  /** User-Agent header sent to the GitHub API. */
  userAgent?: string
}

/** Schemastery schema with defaults for every configurable value. */
export const Config: Schema<Config> = Schema.object({
  githubToken: Schema.string(),
  timeoutMs: Schema.number().default(10_000),
  defaultLimit: Schema.number().default(5),
  bodyPreviewChars: Schema.number().default(500),
  cacheTtlMs: Schema.number().default(60_000),
  userAgent: Schema.string().default('dsh-github-intelligence/2.10.0'),
})

function assertPositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`github-intelligence: ${name} must be a positive integer (got ${value})`)
  }
}

function assertOwnerRepo(owner: string, repo: string): void {
  if (owner.trim() === '' || repo.trim() === '') {
    throw new Error('github-intelligence: `owner` and `repo` must be non-empty strings')
  }
}

function clampLimit(value: number): number {
  return Math.min(Math.max(Math.trunc(value), 1), 50)
}

function clientOptions(config: Config): GitHubClientOptions {
  const options: GitHubClientOptions = {
    userAgent: config.userAgent ?? 'dsh-github-intelligence/2.10.0',
    timeoutMs: config.timeoutMs ?? 10_000,
    bodyPreviewChars: config.bodyPreviewChars ?? 500,
    cacheTtlMs: config.cacheTtlMs ?? 60_000,
  }
  if (config.githubToken !== undefined && config.githubToken !== '') options.token = config.githubToken
  return options
}

function renderRepo(repo: GitHubRepo): string {
  const topics = repo.topics.length > 0 ? ` · Topics: ${repo.topics.slice(0, 8).join(', ')}` : ''
  const archived = repo.archived ? ' · ARCHIVED' : ''
  return [
    `${repo.fullName} — ${repo.description ?? 'no description'}${archived}`,
    `Stars: ${repo.stars} · Forks: ${repo.forks} · Open issues: ${repo.openIssues} · Default branch: ${repo.defaultBranch ?? 'n/a'}`,
    `Language: ${repo.language ?? 'n/a'} · License: ${repo.license ?? 'n/a'}`,
    `Created: ${repo.createdAt?.slice(0, 10) ?? 'n/a'} · Updated: ${repo.updatedAt?.slice(0, 10) ?? 'n/a'} · Pushed: ${repo.pushedAt?.slice(0, 10) ?? 'n/a'}${topics}`,
    repo.homepage ?? '',
    repo.htmlUrl,
  ].filter((line) => line !== '').join('\n')
}

function renderReleases(value: { fullName: string; releases: GitHubRelease[] }): string {
  if (value.releases.length === 0) return `No releases found for ${value.fullName}.`
  return `Recent releases for ${value.fullName}:\n` + value.releases.map((release) => {
    const date = release.publishedAt !== null ? release.publishedAt.slice(0, 10) : 'unknown date'
    const flag = release.prerelease ? ' [prerelease]' : ''
    return `- ${release.tagName} (${date})${flag} ${release.htmlUrl}`
  }).join('\n')
}

function renderSearch(value: { query: string; items: GitHubRepoHit[] }): string {
  if (value.items.length === 0) return `No repositories matched "${value.query}".`
  return `Top results for "${value.query}":\n` + value.items.map((item, index) => {
    return `${index + 1}. ${item.fullName} (★${item.stars}) — ${item.description ?? 'no description'} ${item.htmlUrl}`
  }).join('\n')
}

function renderTrending(value: { period: string; language: string | null; items: GitHubRepoHit[] }): string {
  if (value.items.length === 0) return `No trending repositories found for the last ${value.period}.`
  const filter = value.language !== null ? ` (language: ${value.language})` : ''
  return `Trending repositories created in the last ${value.period}${filter}:\n` + value.items.map((item, index) => {
    return `${index + 1}. ${item.fullName} (★${item.stars}, ${item.language ?? 'n/a'}) — ${item.description ?? 'no description'} ${item.htmlUrl}`
  }).join('\n')
}

function renderUserRepos(value: { username: string; repos: GitHubRepoHit[] }): string {
  if (value.repos.length === 0) return `No repositories found for ${value.username}.`
  return `Top repositories of ${value.username}:\n` + value.repos.map((item, index) => {
    return `${index + 1}. ${item.fullName} (★${item.stars}) — ${item.description ?? 'no description'} ${item.htmlUrl}`
  }).join('\n')
}

function renderWeeklyDigest(value: {
  owner: string
  repo: string
  since: string
  releases: Array<{ tagName: string; publishedAt: string | null; htmlUrl: string }>
  mergedPulls: Array<{ number: number; title: string; mergedAt: string | null; htmlUrl: string }>
  newIssues: Array<{ number: number; title: string; createdAt: string | null; htmlUrl: string }>
  commits: Array<{ sha: string; message: string; author: string | null; date: string | null; htmlUrl: string }>
}): string {
  const lines = [`# ${value.owner}/${value.repo} — weekly digest (since ${value.since})`]
  if (value.releases.length > 0) {
    lines.push('', '## Releases', ...value.releases.map((r) => `- ${r.tagName} (${r.publishedAt?.slice(0, 10) ?? '?'}) ${r.htmlUrl}`))
  }
  if (value.mergedPulls.length > 0) {
    lines.push('', '## Merged pull requests', ...value.mergedPulls.map((p) => `- #${p.number} ${p.title} ${p.htmlUrl}`))
  }
  if (value.newIssues.length > 0) {
    lines.push('', '## New issues', ...value.newIssues.map((i) => `- #${i.number} ${i.title} ${i.htmlUrl}`))
  }
  if (value.commits.length > 0) {
    lines.push('', '## Commits', ...value.commits.map((c) => `- ${c.sha.slice(0, 7)} ${c.message.split('\n')[0]} (${c.author ?? '?'}, ${c.date?.slice(0, 10) ?? '?'})`))
  }
  if (lines.length === 1) lines.push('No releases, merged PRs, new issues, or commits in this window.')
  return lines.join('\n')
}

function renderNotifications(value: {
  state: string
  participating: string
  notifications: Array<{
    unread: boolean
    reason: string
    updatedAt: string | null
    repository: { fullName: string }
    subject: { title: string; type: string; htmlUrl: string | null }
  }>
  attention: { mentions: number; reviewRequests: number; assignments: number; authored: number; other: number }
}): string {
  const lines = [
    '# GitHub attention queue',
    `${value.notifications.length} ${value.state} notification(s) · ${value.participating} participation`,
    `Mentions: ${value.attention.mentions} · Review requests: ${value.attention.reviewRequests} · Assignments: ${value.attention.assignments} · Authored: ${value.attention.authored} · Other: ${value.attention.other}`,
  ]
  if (value.notifications.length === 0) return [...lines, '', 'Nothing needs attention.'].join('\n')
  for (const item of value.notifications) {
    const unread = item.unread ? 'unread' : 'read'
    const url = item.subject.htmlUrl ?? ''
    lines.push(
      '',
      `- [${item.reason}; ${unread}] ${item.repository.fullName} · ${item.subject.type}: ${item.subject.title}${url === '' ? '' : ` ${url}`}`,
    )
  }
  return lines.join('\n')
}

function daysSince(value: string | null): number | null {
  if (value === null) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000))
}

function renderRepoHealth(value: {
  fullName: string
  status: string
  score: number
  scoreBreakdown: { activity: number; release: number; community: number; maintainability: number; contributors: number }
  evidence: {
    pushedAt: string | null
    latestRelease: string | null
    recentCommits: number
    visibleContributors: number
    communityHealthPercentage: number | null
  }
  riskFlags: string[]
  recommendations: string[]
  caveat: string
}): string {
  const lines = [
    `# ${value.fullName} — repository health`,
    `Status: ${value.status.toUpperCase()} · Score: ${value.score}/100`,
    `Activity ${value.scoreBreakdown.activity}/30 · Release ${value.scoreBreakdown.release}/20 · Community ${value.scoreBreakdown.community}/20 · Maintainability ${value.scoreBreakdown.maintainability}/15 · Contributors ${value.scoreBreakdown.contributors}/15`,
    '',
    `Last push: ${value.evidence.pushedAt?.slice(0, 10) ?? 'unknown'} · Latest release: ${value.evidence.latestRelease?.slice(0, 10) ?? 'none'} · Recent commits sampled: ${value.evidence.recentCommits} · Contributors sampled: ${value.evidence.visibleContributors}`,
    `GitHub community profile: ${value.evidence.communityHealthPercentage === null ? 'unavailable' : `${value.evidence.communityHealthPercentage}%`}`,
  ]
  lines.push('', '## Risks', ...(value.riskFlags.length > 0 ? value.riskFlags.map((flag) => `- ${flag}`) : ['- No major heuristic risks detected.']))
  lines.push('', '## Recommended next actions', ...(value.recommendations.length > 0 ? value.recommendations.map((item) => `- ${item}`) : ['- Keep the current maintenance cadence.']))
  lines.push('', value.caveat)
  return lines.join('\n')
}

function renderArxiv(value: {
  query: string
  results: Array<{ id: string; title: string; summary: string; published: string; authors: string[]; link: string }>
}): string {
  if (value.results.length === 0) return `No ArXiv results for "${value.query}".`
  const lines = [`# ArXiv results for "${value.query}"`]
  for (const entry of value.results) {
    const authors = entry.authors.length > 0 ? entry.authors.join(', ') : 'unknown authors'
    lines.push(
      '',
      `## ${entry.title}`,
      `${authors} · ${entry.published.slice(0, 10)}`,
      entry.summary,
      entry.link !== '' ? entry.link : entry.id,
    )
  }
  return lines.join('\n')
}

function renderCompare(value: {
  first: { fullName: string; stars: number; forks: number; openIssues: number; language: string | null; license: string | null; pushedAt: string | null }
  second: { fullName: string; stars: number; forks: number; openIssues: number; language: string | null; license: string | null; pushedAt: string | null }
  deltas: { stars: number; forks: number; openIssues: number }
}): string {
  return [
    `Comparing ${value.first.fullName} vs ${value.second.fullName}:`,
    `Stars: ${value.first.stars} vs ${value.second.stars} (${value.deltas.stars >= 0 ? '+' : ''}${value.deltas.stars})`,
    `Forks: ${value.first.forks} vs ${value.second.forks} (${value.deltas.forks >= 0 ? '+' : ''}${value.deltas.forks})`,
    `Open issues: ${value.first.openIssues} vs ${value.second.openIssues} (${value.deltas.openIssues >= 0 ? '+' : ''}${value.deltas.openIssues})`,
    `Language: ${value.first.language ?? 'n/a'} vs ${value.second.language ?? 'n/a'}`,
    `License: ${value.first.license ?? 'n/a'} vs ${value.second.license ?? 'n/a'}`,
    `Last push: ${value.first.pushedAt?.slice(0, 10) ?? 'n/a'} vs ${value.second.pushedAt?.slice(0, 10) ?? 'n/a'}`,
  ].join('\n')
}

function renderIssues(value: { fullName: string; state: string; issues: GitHubIssue[] }): string {
  if (value.issues.length === 0) return `No ${value.state} issues for ${value.fullName}.`
  return `${value.state === 'open' ? 'Open' : 'Closed'} issues for ${value.fullName}:\n` + value.issues.map((issue) => {
    return `- #${issue.number} ${issue.title} (@${issue.user}, ${issue.comments} comments) ${issue.htmlUrl}`
  }).join('\n')
}

function renderPulls(value: { fullName: string; state: string; pulls: GitHubPull[] }): string {
  if (value.pulls.length === 0) return `No ${value.state} pull requests for ${value.fullName}.`
  return `${value.state === 'open' ? 'Open' : 'Closed'} pull requests for ${value.fullName}:\n` + value.pulls.map((pull) => {
    const merged = pull.mergedAt !== null ? ' [merged]' : ''
    return `- #${pull.number} ${pull.title} (@${pull.user})${merged} ${pull.htmlUrl}`
  }).join('\n')
}

function renderContributors(value: { fullName: string; contributors: GitHubContributor[] }): string {
  if (value.contributors.length === 0) return `No contributor data for ${value.fullName}.`
  return `Top contributors of ${value.fullName}:\n` + value.contributors.map((contributor, index) => {
    return `${index + 1}. ${contributor.login} — ${contributor.contributions} contributions`
  }).join('\n')
}

function renderReport(value: {
  fullName: string
  overview: Pick<GitHubRepo, 'fullName' | 'description' | 'stars' | 'forks' | 'openIssues' | 'language' | 'license' | 'htmlUrl'>
  latestRelease: Pick<GitHubRelease, 'tagName' | 'publishedAt' | 'htmlUrl'> | null
  openIssues: number
  recentCommits: GitHubCommit[]
  topContributors: Pick<GitHubContributor, 'login' | 'contributions'>[]
}): string {
  const release = value.latestRelease
    ? `${value.latestRelease.tagName} (${value.latestRelease.publishedAt?.slice(0, 10) ?? 'unknown date'})`
    : 'none'
  const commits = value.recentCommits.slice(0, 5).map((commit) => {
    return `- ${commit.sha.slice(0, 7)} ${commit.message} (${commit.author ?? 'unknown'})`
  }).join('\n')
  const contributors = value.topContributors.slice(0, 5).map((contributor, index) => {
    return `${index + 1}. ${contributor.login} (${contributor.contributions})`
  }).join(' · ')
  return [
    `# ${value.fullName}`,
    `${value.overview.fullName} — ${value.overview.description ?? 'no description'}`,
    `Stars: ${value.overview.stars} · Forks: ${value.overview.forks} · Open issues: ${value.overview.openIssues}`,
    `Language: ${value.overview.language ?? 'n/a'} · License: ${value.overview.license ?? 'n/a'}`,
    value.overview.htmlUrl,
    '',
    `Latest release: ${release}`,
    `Open issues: ${value.openIssues}`,
    '',
    'Recent commits:',
    commits || '- none',
    '',
    `Top contributors: ${contributors || 'n/a'}`,
  ].join('\n')
}

/**
 * Build the seven tool definitions for a configured client.
 * Exported separately so tests can exercise the definitions without a Context.
 */
export function defineTools(config: Config) {
  const client = new GitHubClient(clientOptions(config))

  const repo = defineTool({
    name: 'github_repo',
    description:
      'Get the current overview of a public GitHub repository: stars, forks, open issues, language, '
      + 'license, topics, default branch, archived status, and activity dates. Use it to evaluate '
      + 'a project or answer questions about repository health.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          homepage: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          stars: { type: 'integer', required: true },
          forks: { type: 'integer', required: true },
          openIssues: { type: 'integer', required: true },
          language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          license: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          topics: { type: 'array', required: true, items: { type: 'string' } },
          defaultBranch: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          archived: { type: 'boolean', required: true },
          createdAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          pushedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          htmlUrl: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderRepo(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      return await client.getRepo(args.owner, args.repo, exec.signal)
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub repo: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const releases = defineTool({
    name: 'github_releases',
    description:
      'List the most recent releases of a public GitHub repository. Use it for release notes, '
      + 'version checks, upgrade planning, and dependency updates.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
      limit: { type: 'number', description: 'How many releases to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          releases: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                tagName: { type: 'string', required: true },
                name: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                publishedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                prerelease: { type: 'boolean', required: true },
                htmlUrl: { type: 'string', required: true },
                bodyPreview: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderReleases(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const releasesList = await client.listReleases(args.owner, args.repo, clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { fullName: `${args.owner}/${args.repo}`, releases: releasesList }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub releases: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const search = defineTool({
    name: 'github_search',
    description:
      'Search public GitHub repositories with GitHub search syntax (for example `agent framework language:typescript`). '
      + 'Returns repositories sorted by stars or last update.',
    parameters: {
      query: { type: 'string', required: true, description: 'GitHub search query, e.g. `deepseek harness`.' },
      limit: { type: 'number', description: 'How many results to return (1-50). Defaults to the configured defaultLimit (5).' },
      sort: { type: 'string', enum: ['stars', 'updated'], description: 'Sort criterion; defaults to stars.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fullName: { type: 'string', required: true },
                description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                stars: { type: 'integer', required: true },
                language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderSearch(value) }],
    },
    async execute(args, exec) {
      if (args.query.trim() === '') throw new Error('github-intelligence: `query` must be a non-empty string')
      const items = await client.searchRepos(args.query, clampLimit(args.limit ?? config.defaultLimit ?? 5), args.sort ?? 'stars', exec.signal)
      return { query: args.query, items }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub search: ${args.query}`, kind: 'search', rawInput: args }),
  })

  const issues = defineTool({
    name: 'github_issues',
    description:
      'List recent issues of a public GitHub repository, filtered by state (open, closed, or all). '
      + 'Pull requests are excluded automatically. Use it for triage, bug research, and project health.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state; defaults to open.' },
      limit: { type: 'number', description: 'How many issues to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          state: { type: 'string', required: true },
          issues: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                title: { type: 'string', required: true },
                state: { type: 'string', enum: ['open', 'closed'], required: true },
                user: { type: 'string', required: true },
                comments: { type: 'integer', required: true },
                createdAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderIssues(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const state = args.state ?? 'open'
      const list = await client.listIssues(args.owner, args.repo, state, clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { fullName: `${args.owner}/${args.repo}`, state, issues: list }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub issues: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const pulls = defineTool({
    name: 'github_pulls',
    description:
      'List recent pull requests of a public GitHub repository, filtered by state (open, closed, or all). '
      + 'Use it to monitor contributions, review queues, and merge activity.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Pull request state; defaults to open.' },
      limit: { type: 'number', description: 'How many pull requests to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          state: { type: 'string', required: true },
          pulls: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                number: { type: 'integer', required: true },
                title: { type: 'string', required: true },
                state: { type: 'string', enum: ['open', 'closed'], required: true },
                user: { type: 'string', required: true },
                createdAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                mergedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderPulls(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const state = args.state ?? 'open'
      const list = await client.listPulls(args.owner, args.repo, state, clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { fullName: `${args.owner}/${args.repo}`, state, pulls: list }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub pulls: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const contributors = defineTool({
    name: 'github_contributors',
    description:
      'List the top contributors of a public GitHub repository by commit count. '
      + 'Use it to identify maintainers, assess community activity, or find who to credit.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
      limit: { type: 'number', description: 'How many contributors to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          contributors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                login: { type: 'string', required: true },
                contributions: { type: 'integer', required: true },
                avatarUrl: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderContributors(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const list = await client.listContributors(args.owner, args.repo, clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { fullName: `${args.owner}/${args.repo}`, contributors: list }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub contributors: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const report = defineTool({
    name: 'github_repo_report',
    description:
      'Produce a deep one-shot report about a public GitHub repository: overview, latest release, '
      + 'open issue count, recent commits, and top contributors. Use it when the user asks for a '
      + 'quick but complete picture of a project. Cached sub-calls keep the rate budget low.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner (user or organization), e.g. deepseek-ai.' },
      repo: { type: 'string', required: true, description: 'Repository name, e.g. deepseek-harness.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          overview: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              fullName: { type: 'string', required: true },
              description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              stars: { type: 'integer', required: true },
              forks: { type: 'integer', required: true },
              openIssues: { type: 'integer', required: true },
              language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              license: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              htmlUrl: { type: 'string', required: true },
            },
          },
          latestRelease: {
            oneOf: [
              {
                type: 'object',
                additionalProperties: false,
                properties: {
                  tagName: { type: 'string', required: true },
                  publishedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                  htmlUrl: { type: 'string', required: true },
                },
              },
              { type: 'null' },
            ],
            required: true,
          },
          openIssues: { type: 'integer', required: true },
          recentCommits: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                sha: { type: 'string', required: true },
                message: { type: 'string', required: true },
                author: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                date: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
          topContributors: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                login: { type: 'string', required: true },
                contributions: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderReport(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const limit = config.defaultLimit ?? 5
      const overview = await client.getRepo(args.owner, args.repo, exec.signal)
      const [releaseList, commits, contributorsList] = await Promise.all([
        client.listReleases(args.owner, args.repo, 1, exec.signal),
        client.recentCommits(args.owner, args.repo, 5, exec.signal),
        client.listContributors(args.owner, args.repo, limit, exec.signal),
      ])
      const latestRelease = releaseList[0] ?? null
      return {
        fullName: `${args.owner}/${args.repo}`,
        overview: {
          fullName: overview.fullName,
          description: overview.description,
          stars: overview.stars,
          forks: overview.forks,
          openIssues: overview.openIssues,
          language: overview.language,
          license: overview.license,
          htmlUrl: overview.htmlUrl,
        },
        latestRelease: latestRelease === null ? null : {
          tagName: latestRelease.tagName,
          publishedAt: latestRelease.publishedAt,
          htmlUrl: latestRelease.htmlUrl,
        },
        openIssues: overview.openIssues,
        recentCommits: commits,
        topContributors: contributorsList.map((contributor) => ({
          login: contributor.login,
          contributions: contributor.contributions,
        })),
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub report: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const compare = defineTool({
    name: 'github_compare',
    description:
      'Compare two public GitHub repositories side by side: stars, forks, open issues, language, '
      + 'license, and last push time, with numeric deltas. Use it for "which project is healthier" '
      + 'questions and framework bake-offs. Sub-calls reuse the cache.',
    parameters: {
      ownerA: { type: 'string', required: true, description: 'Owner of the first repository.' },
      repoA: { type: 'string', required: true, description: 'Name of the first repository.' },
      ownerB: { type: 'string', required: true, description: 'Owner of the second repository.' },
      repoB: { type: 'string', required: true, description: 'Name of the second repository.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          first: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              fullName: { type: 'string', required: true },
              stars: { type: 'integer', required: true },
              forks: { type: 'integer', required: true },
              openIssues: { type: 'integer', required: true },
              language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              license: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              pushedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            },
          },
          second: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              fullName: { type: 'string', required: true },
              stars: { type: 'integer', required: true },
              forks: { type: 'integer', required: true },
              openIssues: { type: 'integer', required: true },
              language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              license: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              pushedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
            },
          },
          deltas: {
            type: 'object',
            additionalProperties: false,
            required: true,
            properties: {
              stars: { type: 'integer', required: true },
              forks: { type: 'integer', required: true },
              openIssues: { type: 'integer', required: true },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderCompare(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.ownerA, args.repoA)
      assertOwnerRepo(args.ownerB, args.repoB)
      const [first, second] = await Promise.all([
        client.getRepo(args.ownerA, args.repoA, exec.signal),
        client.getRepo(args.ownerB, args.repoB, exec.signal),
      ])
      return {
        first: {
          fullName: first.fullName,
          stars: first.stars,
          forks: first.forks,
          openIssues: first.openIssues,
          language: first.language,
          license: first.license,
          pushedAt: first.pushedAt,
        },
        second: {
          fullName: second.fullName,
          stars: second.stars,
          forks: second.forks,
          openIssues: second.openIssues,
          language: second.language,
          license: second.license,
          pushedAt: second.pushedAt,
        },
        deltas: {
          stars: first.stars - second.stars,
          forks: first.forks - second.forks,
          openIssues: first.openIssues - second.openIssues,
        },
      }
    },
    presentCall: (args) => ({
      card: 'generic',
      title: `GitHub compare: ${args.ownerA}/${args.repoA} vs ${args.ownerB}/${args.repoB}`,
      kind: 'search',
      rawInput: args,
    }),
  })

  const trending = defineTool({
    name: 'github_trending',
    description:
      'Find recently trending public repositories: repositories created within the last few days, '
      + 'sorted by stars. Optionally filter by language. Use it for "what is hot right now" questions.',
    parameters: {
      limit: { type: 'number', description: 'How many repositories to return (1-50). Defaults to the configured defaultLimit (5).' },
      language: { type: 'string', description: 'Optional language filter, e.g. TypeScript.' },
      sinceDays: { type: 'number', description: 'Look back window in days (1-30). Defaults to 7.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          period: { type: 'string', required: true },
          language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
          items: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fullName: { type: 'string', required: true },
                description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                stars: { type: 'integer', required: true },
                language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderTrending(value) }],
    },
    async execute(args, exec) {
      const days = Math.min(Math.max(Math.trunc(args.sinceDays ?? 7), 1), 30)
      const language = args.language !== undefined && args.language.trim() !== '' ? args.language.trim() : null
      const items = await client.trending(clampLimit(args.limit ?? config.defaultLimit ?? 5), language ?? undefined, days, exec.signal)
      return { period: `${days} days`, language, items }
    },
    presentCall: (args) => ({ card: 'generic', title: 'GitHub trending', kind: 'search', rawInput: args }),
  })

  const userRepos = defineTool({
    name: 'github_user_repos',
    description:
      'List the top repositories of a GitHub user or organization, sorted by stars, excluding forks. '
      + 'Use it to explore a developer\'s portfolio or an organization\'s most important projects.',
    parameters: {
      username: { type: 'string', required: true, description: 'GitHub username or organization, e.g. deepseek-ai.' },
      limit: { type: 'number', description: 'How many repositories to return (1-50). Defaults to the configured defaultLimit (5).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          username: { type: 'string', required: true },
          repos: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                fullName: { type: 'string', required: true },
                description: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                stars: { type: 'integer', required: true },
                language: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                htmlUrl: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderUserRepos(value) }],
    },
    async execute(args, exec) {
      if (args.username.trim() === '') throw new Error('github-intelligence: `username` must be a non-empty string')
      const repos = await client.listUserRepos(args.username.trim(), clampLimit(args.limit ?? config.defaultLimit ?? 5), exec.signal)
      return { username: args.username.trim(), repos }
    },
    presentCall: (args) => ({ card: 'generic', title: `GitHub repos: ${args.username}`, kind: 'search', rawInput: args }),
  })

  const arxivSearch = defineTool({
    name: 'arxiv_search',
    description:
      'Search the ArXiv preprint corpus (physics, CS, math, and more) by keyword. '
      + 'Returns title, authors, published date, abstract summary, and the paper link. '
      + 'No API key required. Use it for literature search and research questions.',
    parameters: {
      query: { type: 'string', required: true, description: 'Search query, e.g. "retrieval-augmented generation" or "diffusion models".' },
      max_results: { type: 'number', description: 'How many results (1-20). Defaults to 5.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', required: true },
          results: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                title: { type: 'string', required: true },
                summary: { type: 'string', required: true },
                published: { type: 'string', required: true },
                authors: { type: 'array', required: true, items: { type: 'string' } },
                link: { type: 'string', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderArxiv(value) }],
    },
    async execute(args, exec) {
      const query = args.query.trim()
      if (query === '') throw new Error('github-intelligence: `query` must be a non-empty string')
      const maxResults = Math.min(Math.max(Math.trunc(args.max_results ?? config.defaultLimit ?? 5), 1), 20)
      const options = clientOptions(config)
      const entries = await searchArxiv({
        query,
        maxResults,
        signal: exec.signal,
        timeoutMs: options.timeoutMs,
        cacheTtlMs: options.cacheTtlMs,
        userAgent: options.userAgent,
      })
      return {
        query,
        results: entries.map((entry) => ({
          id: entry.id,
          title: entry.title,
          summary: entry.summary,
          published: entry.published,
          authors: entry.authors,
          link: entry.link,
        })),
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `ArXiv search: ${args.query}`, kind: 'search', rawInput: args }),
  })

  const weeklyDigest = defineTool({
    name: 'github_weekly_digest',
    description:
      'A one-week digest of a repository: releases, merged pull requests, new issues, and commits from the last N days (default 7). '
      + 'Use it for "what happened this week in owner/repo" questions.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner.' },
      repo: { type: 'string', required: true, description: 'Repository name.' },
      days: { type: 'number', description: 'Look-back window in days (1-30). Defaults to 7.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          owner: { type: 'string', required: true },
          repo: { type: 'string', required: true },
          since: { type: 'string', required: true },
          releases: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: false, properties: {
              tagName: { type: 'string', required: true }, publishedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true }, htmlUrl: { type: 'string', required: true },
            } },
          },
          mergedPulls: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: false, properties: {
              number: { type: 'integer', required: true }, title: { type: 'string', required: true }, mergedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true }, htmlUrl: { type: 'string', required: true },
            } },
          },
          newIssues: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: false, properties: {
              number: { type: 'integer', required: true }, title: { type: 'string', required: true }, createdAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true }, htmlUrl: { type: 'string', required: true },
            } },
          },
          commits: {
            type: 'array', required: true,
            items: { type: 'object', additionalProperties: false, properties: {
              sha: { type: 'string', required: true }, message: { type: 'string', required: true }, author: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true }, date: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true }, htmlUrl: { type: 'string', required: true },
            } },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderWeeklyDigest(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const days = Math.min(Math.max(Math.trunc(args.days ?? 7), 1), 30)
      const since = Date.now() - days * 86_400_000
      // A repo may legitimately 404 on individual endpoints (e.g. GitHub
      // repositories with pull requests disabled). Tolerate those so one
      // missing surface does not kill the whole digest; other errors (auth,
      // rate limits, timeouts) still propagate.
      const tolerateMissing = <T>(promise: Promise<T>): Promise<T | []> => promise.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (/not found|404/i.test(message)) return []
        throw error
      })
      const [releases, pulls, issues, commits] = await Promise.all([
        tolerateMissing(client.listReleases(args.owner, args.repo, 30, exec.signal)),
        tolerateMissing(client.listPulls(args.owner, args.repo, 'closed', 30, exec.signal)),
        tolerateMissing(client.listIssues(args.owner, args.repo, 'open', 30, exec.signal)),
        tolerateMissing(client.recentCommits(args.owner, args.repo, 30, exec.signal)),
      ])
      return {
        owner: args.owner,
        repo: args.repo,
        since: new Date(since).toISOString().slice(0, 10),
        releases: releases.filter((r) => r.publishedAt !== null && Date.parse(r.publishedAt) >= since),
        mergedPulls: pulls.filter((p) => p.mergedAt !== null && Date.parse(p.mergedAt) >= since),
        newIssues: issues.filter((i) => i.createdAt !== null && Date.parse(i.createdAt) >= since),
        commits: commits.filter((c) => c.date !== null && Date.parse(c.date) >= since),
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `Weekly digest: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  const notifications = defineTool({
    name: 'github_notifications',
    description:
      'Read the authenticated user\'s GitHub notification inbox as an actionable maintainer queue. '
      + 'Highlights mentions, review requests, assignments, and authored-thread updates. Requires githubToken with notification read access.',
    parameters: {
      state: { type: 'string', enum: ['unread', 'all'], description: 'Return unread notifications (default) or all notifications.' },
      participation: { type: 'string', enum: ['all', 'participating'], description: 'Return every notification (default) or only threads where the user participates.' },
      limit: { type: 'number', description: 'How many notifications to return (1-50). Defaults to the configured defaultLimit.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          state: { type: 'string', enum: ['unread', 'all'], required: true },
          participating: { type: 'string', enum: ['all', 'participating'], required: true },
          attention: {
            type: 'object', additionalProperties: false, required: true,
            properties: {
              mentions: { type: 'integer', required: true },
              reviewRequests: { type: 'integer', required: true },
              assignments: { type: 'integer', required: true },
              authored: { type: 'integer', required: true },
              other: { type: 'integer', required: true },
            },
          },
          notifications: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                id: { type: 'string', required: true },
                unread: { type: 'boolean', required: true },
                reason: { type: 'string', required: true },
                updatedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                lastReadAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                repository: {
                  type: 'object', additionalProperties: false, required: true,
                  properties: {
                    fullName: { type: 'string', required: true },
                    htmlUrl: { type: 'string', required: true },
                  },
                },
                subject: {
                  type: 'object', additionalProperties: false, required: true,
                  properties: {
                    title: { type: 'string', required: true },
                    type: { type: 'string', required: true },
                    apiUrl: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                    htmlUrl: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                    latestCommentUrl: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
                  },
                },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderNotifications(value) }],
    },
    async execute(args, exec) {
      const state = args.state ?? 'unread'
      const participating = args.participation ?? 'all'
      const list = await client.listNotifications(
        state === 'all',
        participating === 'participating',
        clampLimit(args.limit ?? config.defaultLimit ?? 5),
        exec.signal,
      )
      const attention = { mentions: 0, reviewRequests: 0, assignments: 0, authored: 0, other: 0 }
      for (const item of list) {
        if (item.reason === 'mention' || item.reason === 'team_mention') attention.mentions += 1
        else if (item.reason === 'review_requested') attention.reviewRequests += 1
        else if (item.reason === 'assign') attention.assignments += 1
        else if (item.reason === 'author') attention.authored += 1
        else attention.other += 1
      }
      return { state, participating, attention, notifications: list }
    },
    presentCall: () => ({ card: 'generic', title: 'GitHub attention queue', kind: 'search' }),
  })

  const repoHealth = defineTool({
    name: 'github_repo_health',
    description:
      'Run an evidence-based repository health audit using activity recency, releases, GitHub community files, '
      + 'maintainability metadata, and contributor visibility. Returns a transparent score, risk flags, and concrete next actions.',
    parameters: {
      owner: { type: 'string', required: true, description: 'Repository owner.' },
      repo: { type: 'string', required: true, description: 'Repository name.' },
    },
    output: {
      schema: {
        type: 'object', additionalProperties: false,
        properties: {
          fullName: { type: 'string', required: true },
          status: { type: 'string', enum: ['healthy', 'watch', 'risk'], required: true },
          score: { type: 'integer', required: true },
          scoreBreakdown: {
            type: 'object', additionalProperties: false, required: true,
            properties: {
              activity: { type: 'integer', required: true },
              release: { type: 'integer', required: true },
              community: { type: 'integer', required: true },
              maintainability: { type: 'integer', required: true },
              contributors: { type: 'integer', required: true },
            },
          },
          evidence: {
            type: 'object', additionalProperties: false, required: true,
            properties: {
              pushedAt: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              latestRelease: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              recentCommits: { type: 'integer', required: true },
              visibleContributors: { type: 'integer', required: true },
              communityHealthPercentage: { oneOf: [{ type: 'integer' }, { type: 'null' }], required: true },
              communityFiles: {
                oneOf: [
                  {
                    type: 'object', additionalProperties: false,
                    properties: {
                      codeOfConduct: { type: 'boolean', required: true },
                      contributing: { type: 'boolean', required: true },
                      issueTemplate: { type: 'boolean', required: true },
                      pullRequestTemplate: { type: 'boolean', required: true },
                      readme: { type: 'boolean', required: true },
                      security: { type: 'boolean', required: true },
                      license: { type: 'boolean', required: true },
                    },
                  },
                  { type: 'null' },
                ],
                required: true,
              },
            },
          },
          riskFlags: { type: 'array', required: true, items: { type: 'string' } },
          recommendations: { type: 'array', required: true, items: { type: 'string' } },
          caveat: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderRepoHealth(value) }],
    },
    async execute(args, exec) {
      assertOwnerRepo(args.owner, args.repo)
      const missingIsNull = <T>(promise: Promise<T>): Promise<T | null> => promise.catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        if (/not found|404/i.test(message)) return null
        throw error
      })
      const [overview, releaseList, commits, contributorsList, communityProfile] = await Promise.all([
        client.getRepo(args.owner, args.repo, exec.signal),
        client.listReleases(args.owner, args.repo, 5, exec.signal),
        client.recentCommits(args.owner, args.repo, 10, exec.signal),
        client.listContributors(args.owner, args.repo, 10, exec.signal),
        missingIsNull(client.getCommunityProfile(args.owner, args.repo, exec.signal)),
      ])
      const pushAge = daysSince(overview.pushedAt)
      const latestRelease = releaseList[0]?.publishedAt ?? null
      const releaseAge = daysSince(latestRelease)
      const activity = pushAge === null ? 0 : pushAge <= 7 ? 30 : pushAge <= 30 ? 25 : pushAge <= 90 ? 18 : pushAge <= 180 ? 10 : pushAge <= 365 ? 5 : 0
      const release = releaseAge === null ? 0 : releaseAge <= 30 ? 20 : releaseAge <= 90 ? 16 : releaseAge <= 365 ? 10 : releaseAge <= 730 ? 5 : 2
      const community = communityProfile === null ? 0 : Math.round(communityProfile.healthPercentage * 0.2)
      const maintainability = (overview.archived ? 0 : 5) + (overview.license === null ? 0 : 5) + (overview.defaultBranch === null ? 0 : 3) + (overview.description === null ? 0 : 2)
      const contributorCount = contributorsList.length
      const contributors = contributorCount >= 10 ? 15 : contributorCount >= 5 ? 12 : contributorCount >= 3 ? 9 : contributorCount >= 2 ? 6 : contributorCount >= 1 ? 3 : 0
      const scoreBreakdown = { activity, release, community, maintainability, contributors }
      const score = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0)
      const riskFlags: string[] = []
      const recommendations: string[] = []
      if (overview.archived) {
        riskFlags.push('Repository is archived and read-only.')
        recommendations.push('Publish a maintained successor or clearly document archival status.')
      }
      if (pushAge === null || pushAge > 180) {
        riskFlags.push('No recent push activity was detected in the last 180 days.')
        recommendations.push('Resume a visible maintenance cadence or document the project as stable/maintenance-only.')
      }
      if (latestRelease === null) {
        riskFlags.push('No GitHub release was found.')
        recommendations.push('Publish versioned releases with concise changelogs.')
      } else if (releaseAge !== null && releaseAge > 365) {
        riskFlags.push('The latest GitHub release is more than one year old.')
        recommendations.push('Cut a current release or explain the release policy.')
      }
      if (communityProfile === null) {
        riskFlags.push('GitHub community profile data is unavailable.')
        recommendations.push('Add standard community-health files and verify GitHub can detect them.')
      } else {
        if (!communityProfile.files.security) {
          riskFlags.push('No SECURITY.md was detected.')
          recommendations.push('Add a SECURITY.md with supported versions and a private reporting path.')
        }
        if (!communityProfile.files.readme) {
          riskFlags.push('No README was detected by GitHub community health.')
          recommendations.push('Add a root README with installation, examples, support, and limitations.')
        }
      }
      if (overview.license === null) {
        riskFlags.push('No machine-readable license was detected.')
        recommendations.push('Add an explicit SPDX-compatible license file.')
      }
      if (contributorCount <= 1) {
        riskFlags.push('Contributor visibility is concentrated in one or zero accounts.')
        recommendations.push('Document contribution and review paths to reduce maintainer concentration risk.')
      }
      const status: 'healthy' | 'watch' | 'risk' = overview.archived || score < 50 ? 'risk' : score < 75 ? 'watch' : 'healthy'
      return {
        fullName: overview.fullName,
        status,
        score,
        scoreBreakdown,
        evidence: {
          pushedAt: overview.pushedAt,
          latestRelease,
          recentCommits: commits.length,
          visibleContributors: contributorCount,
          communityHealthPercentage: communityProfile?.healthPercentage ?? null,
          communityFiles: communityProfile?.files ?? null,
        },
        riskFlags,
        recommendations,
        caveat: 'This is a transparent maintenance heuristic, not a security audit, quality guarantee, or adoption metric.',
      }
    },
    presentCall: (args) => ({ card: 'generic', title: `Repository health: ${args.owner}/${args.repo}`, kind: 'search', rawInput: args }),
  })

  return [repo, releases, search, issues, pulls, contributors, report, compare, trending, userRepos, arxivSearch, weeklyDigest, notifications, repoHealth] as const
}

/**
 * Register all plugin tools on the tool registry.
 * @param ctx - registrant context carrying the tool registry.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  assertPositiveInteger('timeoutMs', config.timeoutMs ?? 10_000)
  assertPositiveInteger('defaultLimit', config.defaultLimit ?? 5)
  assertPositiveInteger('bodyPreviewChars', config.bodyPreviewChars ?? 500)
  assertPositiveInteger('cacheTtlMs', config.cacheTtlMs ?? 60_000)
  for (const tool of defineTools(config)) {
    ctx.tools.register(tool)
  }
  const githubClient = new GitHubClient(clientOptions(config))
  const options = clientOptions(config)
  const ecosystemClient = new EcosystemClient({
    userAgent: options.userAgent,
    timeoutMs: options.timeoutMs,
    cacheTtlMs: options.cacheTtlMs,
  })
  const githubFetcher: Fetcher = (path, signal, cacheKey) => githubClient.raw(path, signal, cacheKey)
  for (const spec of catalog) {
    const fetcher: Fetcher = spec.baseUrl !== undefined
      ? (path, signal, cacheKey) => ecosystemClient.raw(`${spec.baseUrl}${path}`, signal, cacheKey)
      : githubFetcher
    ctx.tools.register(buildCatalogTool(fetcher, spec))
  }
  ctx.tools.register(buildHelpTool(catalog.length + 14))
}
