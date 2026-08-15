/**
 * Declarative catalog of 100+ read-only GitHub tools.
 *
 * Each spec is one line of intent; the generator wires it into a full
 * defineTool with schema validation, cancellation, caching, canonical JSON,
 * and model-facing rendering. Quality is enforced by framework tests, a
 * catalog-completeness test, and the dsh boot smoke test.
 * @module dsh-github-intelligence/catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
export interface ParamSpec {
  type: 'string' | 'number'
  required?: boolean
  description: string
  enum?: readonly string[]
  default?: number | string
}

export interface ToolSpec {
  name: string
  description: string
  kind: 'list' | 'object' | 'string-list' | 'text'
  itemType?: string
  /** Path template; {placeholders} become required string params. */
  path: string
  /** Base URL override for non-GitHub ecosystems. */
  baseUrl?: string
  /** How to unwrap the raw JSON before parsing (results/items/children/crate/versions/data/releases). */
  wrap?: string
  /** Extra query params (limit, state, language, ...). */
  params?: Record<string, ParamSpec>
  example?: string
  authNote?: string
}

export type Fetcher = (path: string, signal: AbortSignal, cacheKey?: string) => Promise<unknown>

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function unwrap(raw: unknown, wrap?: string): unknown {
  const r = raw as Record<string, unknown>
  switch (wrap) {
    case 'results': return r.results
    case 'items': return r.items
    case 'objects': return r.objects
    case 'children': {
      const data = r.data
      if (Array.isArray(data) && data.length > 0 && typeof data[0] === 'object' && 'data' in (data[0] as Record<string, unknown>)) {
        return (data as Array<Record<string, unknown>>).map((entry) => entry.data)
      }
      // Real Reddit shape: { data: { children: [{ data: {...} }] } }
      if (data !== null && typeof data === 'object') {
        const children = (data as Record<string, unknown>).children
        if (Array.isArray(children)) {
          return children.map((entry) => {
            const item = entry as Record<string, unknown>
            return item.data ?? entry
          })
        }
      }
      return raw
    }
    case 'crate': return r.crate
    case 'versions': return r.versions
    case 'data': return r.data
    case 'releases': return r.releases
    case 'users': return r.users
    default: return raw
  }
}

function s(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function n(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function d(value: unknown): string | null {
  const text = s(value)
  return text === null ? null : text.slice(0, 10)
}

function loginOf(value: unknown): string {
  const user = value as Record<string, unknown> | null
  return user !== null && typeof user === 'object' ? s(user.login) ?? 'unknown' : 'unknown'
}

/* ------------------------------------------------------------------ */
/* Parsers: raw API JSON -> canonical item/object                      */
/* ------------------------------------------------------------------ */

const parsers: Record<string, (raw: unknown, name?: unknown) => unknown> = {
  repoHit(raw) {
    const r = raw as Record<string, unknown>
    return {
      fullName: s(r.full_name) ?? 'unknown',
      description: s(r.description),
      stars: n(r.stargazers_count),
      language: s(r.language),
      updatedAt: d(r.updated_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  collaborator(raw) {
    const r = raw as Record<string, unknown>
    const permissions = r.permissions as Record<string, unknown> | null
    const permission = permissions !== null && typeof permissions === 'object'
      ? ['admin', 'maintain', 'push', 'triage', 'pull'].find((key) => permissions[key] === true)
      : undefined
    return {
      login: s(r.login) ?? 'unknown',
      avatarUrl: s(r.avatar_url),
      htmlUrl: s(r.html_url) ?? '',
      permission: permission ?? 'none',
    }
  },
  gitRef(raw) {
    const r = raw as Record<string, unknown>
    const object = r.object as Record<string, unknown> | null
    return {
      ref: s(r.ref) ?? '',
      type: object !== null && typeof object === 'object' ? s(object.type) ?? '' : '',
      sha: object !== null && typeof object === 'object' ? s(object.sha) ?? '' : '',
      htmlUrl: s(r.html_url),
    }
  },
  punchCard(raw) {
    const entry = Array.isArray(raw) ? raw : []
    return { day: n(entry[0]), hour: n(entry[1]), count: n(entry[2]) }
  },
  advisory(raw) {
    const r = raw as Record<string, unknown>
    return {
      ghsaId: s(r.ghsa_id) ?? '',
      summary: s(r.summary) ?? '',
      severity: s(r.severity) ?? 'unknown',
      publishedAt: d(r.published_at),
      updatedAt: d(r.updated_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  socialAccount(raw) {
    const r = raw as Record<string, unknown>
    return {
      provider: s(r.provider) ?? '',
      url: s(r.url) ?? '',
    }
  },
  user(raw) {
    const r = raw as Record<string, unknown>
    return {
      login: s(r.login) ?? 'unknown',
      name: s(r.name),
      avatarUrl: s(r.avatar_url),
      htmlUrl: s(r.html_url) ?? '',
      type: s(r.type) ?? 'User',
    }
  },
  starredUser(raw) {
    const r = raw as Record<string, unknown>
    return {
      login: s(r.login) ?? 'unknown',
      avatarUrl: s(r.avatar_url),
      htmlUrl: s(r.html_url) ?? '',
      starredAt: d(r.starred_at),
    }
  },
  org(raw) {
    const r = raw as Record<string, unknown>
    return {
      login: s(r.login) ?? 'unknown',
      name: s(r.name),
      description: s(r.description),
      htmlUrl: s(r.html_url) ?? '',
      publicRepos: n(r.public_repos),
    }
  },
  release(raw) {
    const r = raw as Record<string, unknown>
    return {
      tagName: s(r.tag_name) ?? 'unknown',
      name: s(r.name),
      publishedAt: d(r.published_at),
      prerelease: r.prerelease === true,
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  issue(raw) {
    const r = raw as Record<string, unknown>
    return {
      number: n(r.number),
      title: s(r.title) ?? 'untitled',
      state: r.state === 'closed' ? 'closed' : 'open',
      user: loginOf(r.user),
      comments: n(r.comments),
      createdAt: d(r.created_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  pull(raw) {
    const r = raw as Record<string, unknown>
    return {
      number: n(r.number),
      title: s(r.title) ?? 'untitled',
      state: r.state === 'closed' ? 'closed' : 'open',
      user: loginOf(r.user),
      createdAt: d(r.created_at),
      mergedAt: d(r.merged_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  commit(raw) {
    const r = raw as Record<string, unknown>
    const c = r.commit as Record<string, unknown> | null
    const author = c !== null && typeof c === 'object' ? c.author as Record<string, unknown> | null : null
    const message = s(c !== null && typeof c === 'object' ? c.message : null)
    return {
      sha: s(r.sha) ?? '',
      message: message !== null ? message.split('\n')[0] ?? '' : '',
      author: author !== null && typeof author === 'object' ? s(author.name) : null,
      date: author !== null && typeof author === 'object' ? d(author.date) : null,
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  branch(raw) {
    const r = raw as Record<string, unknown>
    const c = r.commit as Record<string, unknown> | null
    return {
      name: s(r.name) ?? 'unknown',
      sha: c !== null && typeof c === 'object' ? s(c.sha) ?? '' : '',
      protected: r.protected === true,
    }
  },
  tag(raw) {
    const r = raw as Record<string, unknown>
    const c = r.commit as Record<string, unknown> | null
    return {
      name: s(r.name) ?? 'unknown',
      sha: c !== null && typeof c === 'object' ? s(c.sha) ?? '' : '',
      tarballUrl: s(r.tarball_url),
      zipballUrl: s(r.zipball_url),
    }
  },
  label(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? 'unknown',
      color: s(r.color) ?? '',
      description: s(r.description),
      default: r.default === true,
    }
  },
  milestone(raw) {
    const r = raw as Record<string, unknown>
    return {
      number: n(r.number),
      title: s(r.title) ?? 'untitled',
      state: s(r.state) ?? 'open',
      openIssues: n(r.open_issues),
      closedIssues: n(r.closed_issues),
      dueOn: d(r.due_on),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  contributor(raw) {
    const r = raw as Record<string, unknown>
    return {
      login: s(r.login) ?? 'unknown',
      contributions: n(r.contributions),
      avatarUrl: s(r.avatar_url),
    }
  },
  comment(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      user: loginOf(r.user),
      body: s(r.body) ?? '',
      createdAt: d(r.created_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  review(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      user: loginOf(r.user),
      state: s(r.state) ?? '',
      submittedAt: d(r.submitted_at),
      body: s(r.body) ?? '',
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  fileChange(raw) {
    const r = raw as Record<string, unknown>
    return {
      filename: s(r.filename) ?? '',
      status: s(r.status) ?? '',
      additions: n(r.additions),
      deletions: n(r.deletions),
      changes: n(r.changes),
    }
  },
  deployment(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      ref: s(r.ref) ?? '',
      sha: s(r.sha) ?? '',
      environment: s(r.environment) ?? '',
      createdAt: d(r.created_at),
      description: s(r.description),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  environment(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? 'unknown',
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  workflow(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? 'unknown',
      state: s(r.state) ?? '',
      path: s(r.path) ?? '',
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  workflowRun(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? 'run',
      headBranch: s(r.head_branch) ?? '',
      event: s(r.event) ?? '',
      status: s(r.status) ?? '',
      conclusion: s(r.conclusion),
      createdAt: d(r.created_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  job(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? 'job',
      status: s(r.status) ?? '',
      conclusion: s(r.conclusion),
      startedAt: d(r.started_at),
      completedAt: d(r.completed_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  checkRun(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? 'check',
      status: s(r.status) ?? '',
      conclusion: s(r.conclusion),
      startedAt: d(r.started_at),
      completedAt: d(r.completed_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  status(raw) {
    const r = raw as Record<string, unknown>
    return {
      state: s(r.state) ?? '',
      totalCount: n(r.total_count),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  artifact(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? 'artifact',
      sizeInBytes: n(r.size_in_bytes),
      archived: r.archived === true,
      createdAt: d(r.created_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  package(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? 'package',
      packageType: s(r.package_type) ?? '',
      visibility: s(r.visibility) ?? '',
      htmlUrl: s(r.html_url) ?? '',
      createdAt: d(r.created_at),
    }
  },
  project(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? 'project',
      state: s(r.state) ?? '',
      htmlUrl: s(r.html_url) ?? '',
      createdAt: d(r.created_at),
    }
  },
  treeItem(raw) {
    const r = raw as Record<string, unknown>
    return {
      path: s(r.path) ?? '',
      type: s(r.type) ?? '',
      mode: s(r.mode) ?? '',
      size: n(r.size),
      sha: s(r.sha) ?? '',
    }
  },
  contentsItem(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      path: s(r.path) ?? '',
      type: s(r.type) ?? '',
      size: n(r.size),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  event(raw) {
    const r = raw as Record<string, unknown>
    const repo = r.repo as Record<string, unknown> | null
    return {
      type: s(r.type) ?? '',
      actor: loginOf(r.actor),
      createdAt: d(r.created_at),
      repoName: repo !== null && typeof repo === 'object' ? s(repo.name) ?? '' : '',
    }
  },
  gist(raw) {
    const r = raw as Record<string, unknown>
    const files = r.files as Record<string, unknown> | null
    return {
      id: s(r.id) ?? '',
      description: s(r.description),
      fileCount: files !== null && typeof files === 'object' ? Object.keys(files).length : 0,
      createdAt: d(r.created_at),
      updatedAt: d(r.updated_at),
      htmlUrl: s(r.html_url) ?? '',
      owner: loginOf(r.owner),
    }
  },
  gistCommit(raw) {
    const r = raw as Record<string, unknown>
    const cs = r.change_status as Record<string, unknown> | null
    return {
      version: s(r.version) ?? '',
      committedAt: d(r.committed_at),
      total: cs !== null && typeof cs === 'object' ? n(cs.total) : 0,
    }
  },
  weekStat(raw) {
    const r = raw as unknown[]
    return {
      week: new Date((n(r[0]) as number) * 1000).toISOString().slice(0, 10),
      additions: n(r[1]),
      deletions: n(r[2]),
    }
  },
  commitActivity(raw) {
    const r = raw as Record<string, unknown>
    return {
      week: new Date(n(r.week) * 1000).toISOString().slice(0, 10),
      total: n(r.total),
    }
  },
  emoji(raw, name) {
    return { name: String(name), url: s((raw as Record<string, unknown>).url) ?? '' }
  },
  licenseInfo(raw) {
    const r = raw as Record<string, unknown>
    return {
      key: s(r.key) ?? '',
      name: s(r.name) ?? 'unknown',
      spdxId: s(r.spdx_id),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  releaseAsset(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? '',
      label: s(r.label),
      sizeInBytes: n(r.size_in_bytes),
      downloadCount: n(r.download_count),
      createdAt: d(r.created_at),
      browserDownloadUrl: s(r.browser_download_url) ?? '',
    }
  },
  topicHit(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      description: s(r.description),
      url: s(r.url) ?? '',
    }
  },
  npmPackage(raw) {
    const r = raw as Record<string, unknown>
    const p = r.package as Record<string, unknown> | null
    const source = p !== null && typeof p === 'object' ? p : r
    const author = source.author as Record<string, unknown> | null
    return {
      name: s(source.name) ?? '',
      version: s(source.version) ?? '',
      description: s(source.description),
      author: author !== null && typeof author === 'object' ? s(author.name) ?? s(author.username) : s(source.author),
      license: s(source.license),
      modified: d(source.date ?? source.modified),
    }
  },
  npmVersion(raw) {
    const r = raw as Record<string, unknown>
    return {
      version: s(r.version) ?? '',
      publishedAt: d(r.publishedAt ?? r.time),
    }
  },
  crateSearchHit(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      description: s(r.description),
      downloads: n(r.downloads),
      maxVersion: s(r.max_version),
      updatedAt: d(r.updated_at),
    }
  },
  crateVersion(raw) {
    const r = raw as Record<string, unknown>
    return {
      num: s(r.num) ?? '',
      created: d(r.created_at),
      downloads: n(r.downloads),
    }
  },
  dockerRepoHit(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.repo_name) ?? s(r.name) ?? '',
      description: s(r.short_description),
      stars: n(r.star_count),
      pulls: n(r.pull_count),
      isOfficial: r.is_official === true,
      lastUpdated: d(r.last_updated),
    }
  },
  dockerTag(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      sizeBytes: n(r.full_size),
      lastUpdated: d(r.last_updated),
      digest: s(r.digest),
    }
  },
  hfModelHit(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: s(r.id) ?? '',
      downloads: n(r.downloads),
      likes: n(r.likes),
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 8) : [],
      modifiedAt: d(r.lastModified),
    }
  },
  hfDatasetHit(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: s(r.id) ?? '',
      downloads: n(r.downloads),
      likes: n(r.likes),
      modifiedAt: d(r.lastModified),
    }
  },
  hfSpaceHit(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: s(r.id) ?? '',
      likes: n(r.likes),
      modifiedAt: d(r.lastModified),
    }
  },
  hnItem(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      type: s(r.type) ?? '',
      title: s(r.title),
      by: s(r.by),
      score: n(r.score),
      time: s(r.time) !== null ? new Date(n(r.time) * 1000).toISOString().slice(0, 10) : null,
      url: s(r.url),
      comments: n(r.descendants),
    }
  },
  hnUser(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: s(r.id) ?? '',
      karma: n(r.karma),
      created: s(r.created) !== null ? new Date(n(r.created) * 1000).toISOString().slice(0, 10) : null,
    }
  },
  soQuestion(raw) {
    const r = raw as Record<string, unknown>
    return {
      questionId: n(r.question_id),
      title: s(r.title) ?? '',
      score: n(r.score),
      answerCount: n(r.answer_count),
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      link: s(r.link) ?? '',
      isAnswered: r.is_answered === true,
    }
  },
  redditPost(raw) {
    const r = raw as Record<string, unknown>
    return {
      title: s(r.title) ?? '',
      subreddit: s(r.subreddit) ?? '',
      score: n(r.score),
      numComments: n(r.num_comments),
      author: s(r.author) ?? '',
      created: s(r.created_utc) !== null ? new Date(n(r.created_utc) * 1000).toISOString().slice(0, 10) : null,
      url: s(r.url) ?? '',
      permalink: s(r.permalink) !== null ? `https://www.reddit.com${r.permalink}` : '',
    }
  },
  gitlabProject(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? '',
      nameWithNamespace: s(r.path_with_namespace) ?? s(r.name_with_namespace) ?? '',
      description: s(r.description),
      stars: n(r.star_count),
      forks: n(r.forks_count),
      lastActivityAt: d(r.last_activity_at),
      webUrl: s(r.web_url) ?? '',
    }
  },
  giteeRepo(raw) {
    const r = raw as Record<string, unknown>
    return {
      fullName: s(r.full_name) ?? '',
      description: s(r.description),
      stars: n(r.stargazers_count),
      forks: n(r.forks_count),
      language: s(r.language),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  gitlabIssue(raw) {
    const r = raw as Record<string, unknown>
    const author = r.author as Record<string, unknown> | null
    return {
      iid: n(r.iid),
      title: s(r.title) ?? '',
      state: s(r.state) ?? '',
      author: author !== null && typeof author === 'object' ? s(author.username) ?? 'unknown' : 'unknown',
      createdAt: d(r.created_at),
      comments: n(r.user_notes_count),
      webUrl: s(r.web_url) ?? '',
    }
  },
  gitlabMr(raw) {
    const r = raw as Record<string, unknown>
    const author = r.author as Record<string, unknown> | null
    return {
      iid: n(r.iid),
      title: s(r.title) ?? '',
      state: s(r.state) ?? '',
      author: author !== null && typeof author === 'object' ? s(author.username) ?? 'unknown' : 'unknown',
      createdAt: d(r.created_at),
      mergedAt: d(r.merged_at),
      webUrl: s(r.web_url) ?? '',
    }
  },
  gitlabCommit(raw) {
    const r = raw as Record<string, unknown>
    return {
      sha: s(r.short_id) ?? s(r.id) ?? '',
      title: s(r.title) ?? '',
      author: s(r.author_name),
      date: d(r.created_at) ?? d(r.committed_date),
      webUrl: s(r.web_url),
    }
  },
  gitlabBranch(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      default: r.default === true,
      protected: r.protected === true,
      merged: r.merged === true,
      webUrl: s(r.web_url),
    }
  },
  giteeRelease(raw) {
    const r = raw as Record<string, unknown>
    return {
      tagName: s(r.tag_name) ?? '',
      name: s(r.name),
      createdAt: d(r.created_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  giteeIssue(raw) {
    const r = raw as Record<string, unknown>
    const user = r.user as Record<string, unknown> | null
    return {
      ident: s(r.ident) ?? (s(r.html_url)?.split('/').pop() ?? (n(r.number) > 0 ? String(n(r.number)) : '')),
      title: s(r.title) ?? '',
      state: s(r.issue_state) ?? s(r.state) ?? '',
      user: user !== null && typeof user === 'object' ? s(user.login) ?? 'unknown' : 'unknown',
      comments: n(r.comments),
      createdAt: d(r.created_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  giteeCommit(raw) {
    const r = raw as Record<string, unknown>
    const commit = r.commit as Record<string, unknown> | null
    const author = commit !== null && typeof commit === 'object' ? (commit.author as Record<string, unknown> | null) : null
    return {
      sha: s(r.sha) ?? '',
      message: commit !== null && typeof commit === 'object' ? s(commit.message) ?? '' : '',
      author: author !== null && typeof author === 'object' ? s(author.name) : null,
      date: author !== null && typeof author === 'object' ? d(author.date) : null,
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  soAnswer(raw) {
    const r = raw as Record<string, unknown>
    const owner = r.owner as Record<string, unknown> | null
    const created = n(r.creation_date) > 0 ? new Date(n(r.creation_date) * 1000).toISOString() : null
    const answerId = n(r.answer_id)
    return {
      answerId,
      score: n(r.score),
      accepted: r.is_accepted === true,
      author: owner !== null && typeof owner === 'object' ? s(owner.display_name) ?? 'unknown' : 'unknown',
      createdAt: created !== null ? created.slice(0, 10) : null,
      link: s(r.link) ?? (answerId > 0 ? `https://stackoverflow.com/a/${answerId}` : ''),
    }
  },
  soTag(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      count: n(r.count),
    }
  },
  devtoArticle(raw) {
    const r = raw as Record<string, unknown>
    const user = r.user as Record<string, unknown> | null
    return {
      id: n(r.id),
      title: s(r.title) ?? '',
      description: s(r.description),
      publishedAt: d(r.published_at) ?? d(r.created_at),
      tags: Array.isArray(r.tag_list) ? (r.tag_list as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      author: user !== null && typeof user === 'object' ? s(user.username) ?? 'unknown' : 'unknown',
      reactions: n(r.positive_reactions_count),
      comments: n(r.comments_count),
      url: s(r.url) ?? `https://dev.to${s(r.path) ?? ''}`,
    }
  },
  devtoArticleDetail(raw) {
    const r = raw as Record<string, unknown>
    const user = r.user as Record<string, unknown> | null
    return {
      id: n(r.id),
      title: s(r.title) ?? '',
      description: s(r.description),
      bodyMarkdown: s(r.body_markdown),
      readingMinutes: n(r.reading_time_minutes),
      publishedAt: d(r.published_at) ?? d(r.created_at),
      tags: Array.isArray(r.tag_list) ? (r.tag_list as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      author: user !== null && typeof user === 'object' ? s(user.username) ?? 'unknown' : 'unknown',
      url: s(r.url) ?? `https://dev.to${s(r.path) ?? ''}`,
    }
  },
  devtoUser(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      username: s(r.username) ?? '',
      name: s(r.name),
      summary: s(r.summary),
      location: s(r.location),
      websiteUrl: s(r.website_url),
      profileImage: s(r.profile_image),
      joinedAt: d(r.joined_at),
    }
  },
  npmDependencies(raw) {
    const r = raw as Record<string, unknown>
    const distTags = r['dist-tags'] as Record<string, unknown> | null
    const latest = distTags !== null && typeof distTags === 'object' ? s(distTags.latest) : null
    const versions = r.versions as Record<string, unknown> | null
    const entry = versions !== null && typeof versions === 'object' && latest !== null
      ? versions[latest] as Record<string, unknown> | null
      : null
    const deps = entry !== null && typeof entry === 'object' ? entry.dependencies as Record<string, unknown> | null : null
    const list = deps !== null && typeof deps === 'object'
      ? Object.entries(deps).map(([name, range]) => ({ name, range: typeof range === 'string' ? range : String(range) }))
      : []
    return {
      package: s(r.name) ?? '',
      version: latest ?? 'unknown',
      deps: list,
    }
  },
  rubygemHit(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      info: s(r.info),
      version: s(r.version),
      downloads: n(r.downloads),
      homepage: s(r.homepage_uri),
      sourceUrl: s(r.source_code_uri),
      projectUrl: s(r.project_uri),
      authors: s(r.authors),
    }
  },
  rubygemDetail(raw) {
    const r = raw as Record<string, unknown>
    const licenses = Array.isArray(r.licenses) ? (r.licenses as unknown[]).filter((x): x is string => typeof x === 'string') : []
    return {
      name: s(r.name) ?? '',
      info: s(r.info),
      version: s(r.version),
      downloads: n(r.downloads),
      homepage: s(r.homepage_uri),
      sourceUrl: s(r.source_code_uri),
      documentationUrl: s(r.documentation_uri),
      projectUrl: s(r.project_uri),
      authors: s(r.authors),
      licenses,
    }
  },
  nugetHit(raw) {
    const r = raw as Record<string, unknown>
    const authors = Array.isArray(r.authors) ? (r.authors as unknown[]).filter((x): x is string => typeof x === 'string') : []
    const tags = Array.isArray(r.tags) ? (r.tags as unknown[]).filter((x): x is string => typeof x === 'string') : []
    return {
      id: s(r.id) ?? '',
      version: s(r.version),
      description: s(r.description) ?? s(r.summary),
      downloads: n(r.totalDownloads),
      projectUrl: s(r.projectUrl),
      authors,
      tags,
    }
  },
  goModuleLatest(raw) {
    const r = raw as Record<string, unknown>
    return {
      version: s(r.Version) ?? '',
      time: d(r.Time),
      origin: s(r.Origin),
    }
  },
  cratesVersion(raw) {
    const r = raw as Record<string, unknown>
    return {
      num: s(r.num) ?? '',
      downloads: n(r.downloads),
      createdAt: d(r.created_at),
      yanked: r.yanked === true,
    }
  },
  giteeContributor(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? 'unknown',
      email: s(r.email),
      contributions: n(r.contributions),
    }
  },
  gitlabTag(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      message: s(r.message),
      protected: r.protected === true,
      sha: s(r.target),
      createdAt: d(r.created_at),
    }
  },
  deploymentStatus(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      state: s(r.state) ?? '',
      environment: s(r.environment),
      description: s(r.description),
      createdAt: d(r.created_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  pagesBuild(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      status: s(r.status) ?? '',
      error: s((r.error as Record<string, unknown> | null)?.message),
      createdAt: d(r.created_at),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  contributorStats(raw) {
    const r = raw as Record<string, unknown>
    const author = r.author as Record<string, unknown> | null
    return {
      author: author !== null && typeof author === 'object' ? s(author.login) ?? 'unknown' : 'unknown',
      total: n(r.total),
    }
  },
  fileContent(raw) {
    const r = raw as Record<string, unknown>
    let contentText = ''
    const content = s(r.content)
    if (content !== null) {
      try {
        contentText = Buffer.from(content, 'base64').toString('utf8').slice(0, 8_000)
      } catch {
        contentText = ''
      }
    }
    return {
      name: s(r.name) ?? '',
      path: s(r.path) ?? '',
      size: n(r.size),
      htmlUrl: s(r.html_url) ?? '',
      contentText,
    }
  },
}

function parseItem(type: string, raw: unknown, key?: string): unknown {
  const parser = parsers[type]
  if (parser === undefined) throw new Error(`catalog: unknown item type ${type}`)
  return key !== undefined ? parser(raw, key) : parser(raw)
}

/* ------------------------------------------------------------------ */
/* Object parsers                                                      */
/* ------------------------------------------------------------------ */

const objectParsers: Record<string, (raw: unknown) => unknown> = {
  languages(raw) {
    const r = raw as Record<string, unknown>
    return {
      languages: Object.entries(r).map(([name, bytes]) => ({ name, bytes: n(bytes) })).sort((a, b) => b.bytes - a.bytes),
    }
  },
  readme(raw) {
    const r = raw as Record<string, unknown>
    let contentText = ''
    const content = s(r.content)
    if (content !== null) {
      try {
        contentText = Buffer.from(content, 'base64').toString('utf8').slice(0, 8_000)
      } catch {
        contentText = ''
      }
    }
    return {
      name: s(r.name) ?? '',
      size: n(r.size),
      htmlUrl: s(r.html_url) ?? '',
      contentText,
    }
  },
  commitCompare(raw) {
    const r = raw as Record<string, unknown>
    return {
      status: s(r.status) ?? '',
      aheadBy: n(r.ahead_by),
      behindBy: n(r.behind_by),
      totalCommits: n(r.total_commits),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  communityProfile(raw) {
    const r = raw as Record<string, unknown>
    return {
      healthPercentage: n(r.health_percentage),
      description: s(r.description),
      documentation: s(r.documentation),
    }
  },
  participation(raw) {
    const r = raw as Record<string, unknown>
    return {
      all: Array.isArray(r.all) ? r.all.filter((x): x is number => typeof x === 'number') : [],
      owner: Array.isArray(r.owner) ? r.owner.filter((x): x is number => typeof x === 'number') : [],
    }
  },
  rateLimit(raw) {
    const r = raw as Record<string, unknown>
    const core = r.core as Record<string, unknown> | null
    const search = r.search as Record<string, unknown> | null
    return {
      coreLimit: core !== null && typeof core === 'object' ? n(core.limit) : 0,
      coreRemaining: core !== null && typeof core === 'object' ? n(core.remaining) : 0,
      coreReset: core !== null && typeof core === 'object' ? s(core.reset) ?? '' : '',
      searchLimit: search !== null && typeof search === 'object' ? n(search.limit) : 0,
      searchRemaining: search !== null && typeof search === 'object' ? n(search.remaining) : 0,
    }
  },
  meta(raw) {
    const r = raw as Record<string, unknown>
    return {
      verifiablePasswordAuthentication: r.verifiable_password_authentication === true,
      apiVersion: s(r.installed_version) ?? '',
    }
  },
  gitignore(raw) {
    const r = raw as Record<string, unknown>
    return { name: s(r.name) ?? '', source: s(r.source) ?? '' }
  },
  pages(raw) {
    const r = raw as Record<string, unknown>
    return {
      status: s(r.status) ?? '',
      cname: s(r.cname),
      htmlUrl: s(r.html_url) ?? '',
    }
  },
  workflowRunUsage(raw) {
    const r = raw as Record<string, unknown>
    const billable = r.billable as Record<string, unknown> | null
    let totalMs = 0
    if (billable !== null && typeof billable === 'object') {
      for (const value of Object.values(billable)) {
        const os = value as Record<string, unknown> | null
        if (os !== null && typeof os === 'object') totalMs += n(os.total_ms)
      }
    }
    return {
      totalMs,
      runStartedAt: d(r.run_started_at),
    }
  },
  npmInfo(raw) {
    const r = raw as Record<string, unknown>
    const distTags = r['dist-tags'] as Record<string, unknown> | null
    const versions = r.versions as Record<string, unknown> | null
    const latest = versions !== null && typeof versions === 'object' ? versions[String(distTags?.latest ?? '')] as Record<string, unknown> | null : null
    const author = (r.author ?? latest?.author) as Record<string, unknown> | null
    return {
      name: s(r.name) ?? '',
      description: s(r.description) ?? s(latest?.description),
      latestVersion: distTags !== null && typeof distTags === 'object' ? s(distTags.latest) ?? '' : '',
      license: s(latest?.license ?? r.license),
      homepage: s(latest?.homepage ?? r.homepage),
      repository: s(((r.repository ?? latest?.repository) as Record<string, unknown> | null)?.url) ?? s((r.repository ?? latest?.repository) as unknown),
      author: author !== null && typeof author === 'object' ? s(author.name) ?? s(author.username) : s(r.author),
      modified: d(r.modified),
    }
  },
  npmVersions(raw) {
    const r = raw as Record<string, unknown>
    const versions = r.versions as Record<string, unknown> | null
    const time = r.time as Record<string, unknown> | null
    const list = versions !== null && typeof versions === 'object'
      ? Object.keys(versions).map((version) => ({ version, publishedAt: time !== null && typeof time === 'object' ? d(time[version]) : null }))
      : []
    return { versions: list }
  },
  pypiProject(raw) {
    const r = raw as Record<string, unknown>
    const info = r.info as Record<string, unknown> | null
    return {
      name: s(info?.name ?? r.name) ?? '',
      summary: s(info?.summary),
      latestVersion: s(info?.version) ?? '',
      author: s(info?.author),
      license: s(info?.license),
      requiresPython: s(info?.requires_python),
      homepage: s(info?.home_page),
      projectUrls: s(info?.project_url),
    }
  },
  pypiVersions(raw) {
    const r = raw as Record<string, unknown>
    const releases = r.releases as Record<string, unknown> | null
    const list = releases !== null && typeof releases === 'object'
      ? Object.entries(releases).map(([version, files]) => ({
          version,
          fileCount: Array.isArray(files) ? files.length : 0,
          uploadDate: Array.isArray(files) && files.length > 0 ? d((files[0] as Record<string, unknown>).upload_time) : null,
        }))
      : []
    return { versions: list }
  },
  crateInfo(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      description: s(r.description),
      downloads: n(r.downloads),
      recentDownloads: n(r.recent_downloads),
      maxVersion: s(r.max_version),
      homepage: s(r.homepage),
      documentation: s(r.documentation),
      repository: s(r.repository),
      created: d(r.created_at),
    }
  },
  crateDownloads(raw) {
    const r = raw as Record<string, unknown>
    return {
      total: n(r.total_downloads),
      recent: n(r.recent_downloads),
      version: s(r.version),
    }
  },
  dockerRepo(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      description: s(r.description),
      stars: n(r.star_count),
      pulls: n(r.pull_count),
      lastUpdated: d(r.last_updated),
    }
  },
  hfModel(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: s(r.id) ?? '',
      downloads: n(r.downloads),
      likes: n(r.likes),
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((x): x is string => typeof x === 'string').slice(0, 12) : [],
      pipelineTag: s(r.pipeline_tag),
      libraryName: s(r.library_name),
      createdAt: d(r.created_at),
      lastModified: d(r.lastModified),
    }
  },
  soQuestionDetail(raw) {
    const r = raw as Record<string, unknown>
    return {
      questionId: n(r.question_id),
      title: s(r.title) ?? '',
      score: n(r.score),
      answerCount: n(r.answer_count),
      tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((x): x is string => typeof x === 'string') : [],
      link: s(r.link) ?? '',
      body: s(r.body)?.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 800) ?? '',
    }
  },
  redditAbout(raw) {
    const r = raw as Record<string, unknown>
    return {
      subreddit: s(r.display_name) ?? '',
      subscribers: n(r.subscribers),
      activeUsers: n(r.active_user_count),
      description: s(r.public_description),
      created: s(r.created_utc) !== null ? new Date(n(r.created_utc) * 1000).toISOString().slice(0, 10) : null,
    }
  },
  dshEcosystemStats(raw) {
    const r = raw as Record<string, unknown>
    const count = n(r.count) || n(r.pluginCount) || n(r.total) || n(r.plugins)
    return {
      pluginCount: count,
      source: s(r.source) ?? 'awesome-dsh-plugin.com',
    }
  },
  npmDownloads(raw) {
    const r = raw as Record<string, unknown>
    return {
      package: s(r.package) ?? '',
      start: s(r.start) ?? '',
      end: s(r.end) ?? '',
      downloads: n(r.downloads),
    }
  },
  gitlabProjectDetail(raw) {
    const r = raw as Record<string, unknown>
    return {
      id: n(r.id),
      name: s(r.name) ?? '',
      description: s(r.description),
      stars: n(r.star_count),
      forks: n(r.forks_count),
      webUrl: s(r.web_url) ?? '',
      defaultBranch: s(r.default_branch),
      visibility: s(r.visibility),
      createdAt: d(r.created_at),
      lastActivityAt: d(r.last_activity_at),
    }
  },
  giteeRepoDetail(raw) {
    const r = raw as Record<string, unknown>
    return {
      fullName: s(r.full_name) ?? '',
      description: s(r.description),
      stars: n(r.stargazers_count),
      forks: n(r.forks_count),
      language: s(r.language),
      license: s((r.license as Record<string, unknown> | null)?.name ?? r.license),
      htmlUrl: s(r.html_url) ?? '',
      updatedAt: d(r.updated_at),
    }
  },
  soUser(raw) {
    const r = raw as Record<string, unknown>
    return {
      userId: n(r.user_id),
      displayName: s(r.display_name) ?? '',
      reputation: n(r.reputation),
      location: s(r.location),
      link: s(r.link) ?? '',
      createdAt: d(r.creation_date) !== null ? new Date(n(r.creation_date) * 1000).toISOString().slice(0, 10) : null,
    }
  },
  redditUser(raw) {
    const r = raw as Record<string, unknown>
    return {
      name: s(r.name) ?? '',
      linkKarma: n(r.link_karma),
      commentKarma: n(r.comment_karma),
      created: s(r.created_utc) !== null ? new Date(n(r.created_utc) * 1000).toISOString().slice(0, 10) : null,
    }
  },
}

function parseObject(type: string, raw: unknown): unknown {
  const parser = objectParsers[type]
  if (parser === undefined) throw new Error(`catalog: unknown object type ${type}`)
  return parser(raw)
}

/* ------------------------------------------------------------------ */
/* Schemas                                                             */
/* ------------------------------------------------------------------ */

function strSchema(required = true) {
  return { type: 'string', required }
}

function nullableStr(required = true) {
  return { oneOf: [{ type: 'string' }, { type: 'null' }], required }
}

function intSchema(required = true) {
  return { type: 'integer', required }
}

function boolSchema(required = true) {
  return { type: 'boolean', required }
}

const itemSchemas: Record<string, object> = {
  repoHit: { type: 'object', additionalProperties: false, properties: {
    fullName: strSchema(), description: nullableStr(), stars: intSchema(), language: nullableStr(), updatedAt: nullableStr(), htmlUrl: strSchema(),
  } },
  user: { type: 'object', additionalProperties: false, properties: {
    login: strSchema(), name: nullableStr(), avatarUrl: nullableStr(), htmlUrl: strSchema(), type: strSchema(),
  } },
  starredUser: { type: 'object', additionalProperties: false, properties: {
    login: strSchema(), avatarUrl: nullableStr(), htmlUrl: strSchema(), starredAt: nullableStr(),
  } },
  org: { type: 'object', additionalProperties: false, properties: {
    login: strSchema(), name: nullableStr(), description: nullableStr(), htmlUrl: strSchema(), publicRepos: intSchema(),
  } },
  release: { type: 'object', additionalProperties: false, properties: {
    tagName: strSchema(), name: nullableStr(), publishedAt: nullableStr(), prerelease: boolSchema(), htmlUrl: strSchema(),
  } },
  issue: { type: 'object', additionalProperties: false, properties: {
    number: intSchema(), title: strSchema(), state: strSchema(), user: strSchema(), comments: intSchema(), createdAt: nullableStr(), htmlUrl: strSchema(),
  } },
  pull: { type: 'object', additionalProperties: false, properties: {
    number: intSchema(), title: strSchema(), state: strSchema(), user: strSchema(), createdAt: nullableStr(), mergedAt: nullableStr(), htmlUrl: strSchema(),
  } },
  commit: { type: 'object', additionalProperties: false, properties: {
    sha: strSchema(), message: strSchema(), author: nullableStr(), date: nullableStr(), htmlUrl: strSchema(),
  } },
  branch: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), sha: strSchema(), protected: boolSchema(),
  } },
  tag: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), sha: strSchema(), tarballUrl: nullableStr(), zipballUrl: nullableStr(),
  } },
  label: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), color: strSchema(), description: nullableStr(), default: boolSchema(),
  } },
  milestone: { type: 'object', additionalProperties: false, properties: {
    number: intSchema(), title: strSchema(), state: strSchema(), openIssues: intSchema(), closedIssues: intSchema(), dueOn: nullableStr(), htmlUrl: strSchema(),
  } },
  contributor: { type: 'object', additionalProperties: false, properties: {
    login: strSchema(), contributions: intSchema(), avatarUrl: nullableStr(),
  } },
  collaborator: { type: 'object', additionalProperties: false, properties: {
    login: strSchema(), avatarUrl: nullableStr(), htmlUrl: strSchema(), permission: strSchema(),
  } },
  gitRef: { type: 'object', additionalProperties: false, properties: {
    ref: strSchema(), type: strSchema(), sha: strSchema(), htmlUrl: nullableStr(),
  } },
  punchCard: { type: 'object', additionalProperties: false, properties: {
    day: intSchema(), hour: intSchema(), count: intSchema(),
  } },
  advisory: { type: 'object', additionalProperties: false, properties: {
    ghsaId: strSchema(), summary: strSchema(), severity: strSchema(), publishedAt: nullableStr(), updatedAt: nullableStr(), htmlUrl: strSchema(),
  } },
  socialAccount: { type: 'object', additionalProperties: false, properties: {
    provider: strSchema(), url: strSchema(),
  } },
  comment: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), user: strSchema(), body: strSchema(), createdAt: nullableStr(), htmlUrl: strSchema(),
  } },
  review: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), user: strSchema(), state: strSchema(), submittedAt: nullableStr(), body: strSchema(), htmlUrl: strSchema(),
  } },
  fileChange: { type: 'object', additionalProperties: false, properties: {
    filename: strSchema(), status: strSchema(), additions: intSchema(), deletions: intSchema(), changes: intSchema(),
  } },
  deployment: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), ref: strSchema(), sha: strSchema(), environment: strSchema(), createdAt: nullableStr(), description: nullableStr(), htmlUrl: strSchema(),
  } },
  environment: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), htmlUrl: strSchema(),
  } },
  workflow: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), state: strSchema(), path: strSchema(), htmlUrl: strSchema(),
  } },
  workflowRun: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), headBranch: strSchema(), event: strSchema(), status: strSchema(), conclusion: nullableStr(), createdAt: nullableStr(), htmlUrl: strSchema(),
  } },
  job: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), status: strSchema(), conclusion: nullableStr(), startedAt: nullableStr(), completedAt: nullableStr(), htmlUrl: strSchema(),
  } },
  checkRun: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), status: strSchema(), conclusion: nullableStr(), startedAt: nullableStr(), completedAt: nullableStr(), htmlUrl: strSchema(),
  } },
  status: { type: 'object', additionalProperties: false, properties: {
    state: strSchema(), totalCount: intSchema(), htmlUrl: strSchema(),
  } },
  artifact: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), sizeInBytes: intSchema(), archived: boolSchema(), createdAt: nullableStr(), htmlUrl: strSchema(),
  } },
  package: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), packageType: strSchema(), visibility: strSchema(), htmlUrl: strSchema(), createdAt: nullableStr(),
  } },
  project: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), state: strSchema(), htmlUrl: strSchema(), createdAt: nullableStr(),
  } },
  treeItem: { type: 'object', additionalProperties: false, properties: {
    path: strSchema(), type: strSchema(), mode: strSchema(), size: intSchema(), sha: strSchema(),
  } },
  contentsItem: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), path: strSchema(), type: strSchema(), size: intSchema(), htmlUrl: strSchema(),
  } },
  event: { type: 'object', additionalProperties: false, properties: {
    type: strSchema(), actor: strSchema(), createdAt: nullableStr(), repoName: strSchema(),
  } },
  gist: { type: 'object', additionalProperties: false, properties: {
    id: strSchema(), description: nullableStr(), fileCount: intSchema(), createdAt: nullableStr(), updatedAt: nullableStr(), htmlUrl: strSchema(), owner: strSchema(),
  } },
  gistCommit: { type: 'object', additionalProperties: false, properties: {
    version: strSchema(), committedAt: nullableStr(), total: intSchema(),
  } },
  weekStat: { type: 'object', additionalProperties: false, properties: {
    week: strSchema(), additions: intSchema(), deletions: intSchema(),
  } },
  commitActivity: { type: 'object', additionalProperties: false, properties: {
    week: strSchema(), total: intSchema(),
  } },
  emoji: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), url: strSchema(),
  } },
  licenseInfo: { type: 'object', additionalProperties: false, properties: {
    key: strSchema(), name: strSchema(), spdxId: nullableStr(), htmlUrl: strSchema(),
  } },
  releaseAsset: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), label: nullableStr(), sizeInBytes: intSchema(), downloadCount: intSchema(), createdAt: nullableStr(), browserDownloadUrl: strSchema(),
  } },
  topicHit: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), description: nullableStr(), url: strSchema(),
  } },
  npmPackage: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), version: strSchema(), description: nullableStr(), author: nullableStr(), license: nullableStr(), modified: nullableStr(),
  } },
  npmVersion: { type: 'object', additionalProperties: false, properties: {
    version: strSchema(), publishedAt: nullableStr(),
  } },
  crateSearchHit: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), description: nullableStr(), downloads: intSchema(), maxVersion: nullableStr(), updatedAt: nullableStr(),
  } },
  crateVersion: { type: 'object', additionalProperties: false, properties: {
    num: strSchema(), created: nullableStr(), downloads: intSchema(),
  } },
  dockerRepoHit: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), description: nullableStr(), stars: intSchema(), pulls: intSchema(), isOfficial: boolSchema(), lastUpdated: nullableStr(),
  } },
  dockerTag: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), sizeBytes: intSchema(), lastUpdated: nullableStr(), digest: nullableStr(),
  } },
  hfModelHit: { type: 'object', additionalProperties: false, properties: {
    id: strSchema(), downloads: intSchema(), likes: intSchema(), tags: { type: 'array', required: true, items: { type: 'string' } }, modifiedAt: nullableStr(),
  } },
  hfDatasetHit: { type: 'object', additionalProperties: false, properties: {
    id: strSchema(), downloads: intSchema(), likes: intSchema(), modifiedAt: nullableStr(),
  } },
  hfSpaceHit: { type: 'object', additionalProperties: false, properties: {
    id: strSchema(), likes: intSchema(), modifiedAt: nullableStr(),
  } },
  hnItem: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), type: strSchema(), title: nullableStr(), by: nullableStr(), score: intSchema(), time: nullableStr(), url: nullableStr(), comments: intSchema(),
  } },
  hnUser: { type: 'object', additionalProperties: false, properties: {
    id: strSchema(), karma: intSchema(), created: nullableStr(),
  } },
  soQuestion: { type: 'object', additionalProperties: false, properties: {
    questionId: intSchema(), title: strSchema(), score: intSchema(), answerCount: intSchema(), tags: { type: 'array', required: true, items: { type: 'string' } }, link: strSchema(), isAnswered: boolSchema(),
  } },
  redditPost: { type: 'object', additionalProperties: false, properties: {
    title: strSchema(), subreddit: strSchema(), score: intSchema(), numComments: intSchema(), author: strSchema(), created: nullableStr(), url: strSchema(), permalink: strSchema(),
  } },
  gitlabProject: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), nameWithNamespace: strSchema(), description: nullableStr(), stars: intSchema(), forks: intSchema(), lastActivityAt: nullableStr(), webUrl: strSchema(),
  } },
  giteeRepo: { type: 'object', additionalProperties: false, properties: {
    fullName: strSchema(), description: nullableStr(), stars: intSchema(), forks: intSchema(), language: nullableStr(), htmlUrl: strSchema(),
  } },
  deploymentStatus: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), state: strSchema(), environment: nullableStr(), description: nullableStr(), createdAt: nullableStr(), htmlUrl: strSchema(),
  } },
  pagesBuild: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), status: strSchema(), error: nullableStr(), createdAt: nullableStr(), htmlUrl: strSchema(),
  } },
  contributorStats: { type: 'object', additionalProperties: false, properties: {
    author: strSchema(), total: intSchema(),
  } },
  fileContent: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), path: strSchema(), size: intSchema(), htmlUrl: strSchema(), contentText: strSchema(),
  } },
  gitlabIssue: { type: 'object', additionalProperties: false, properties: {
    iid: intSchema(), title: strSchema(), state: strSchema(), author: strSchema(), createdAt: nullableStr(), comments: intSchema(), webUrl: strSchema(),
  } },
  gitlabMr: { type: 'object', additionalProperties: false, properties: {
    iid: intSchema(), title: strSchema(), state: strSchema(), author: strSchema(), createdAt: nullableStr(), mergedAt: nullableStr(), webUrl: strSchema(),
  } },
  gitlabCommit: { type: 'object', additionalProperties: false, properties: {
    sha: strSchema(), title: strSchema(), author: nullableStr(), date: nullableStr(), webUrl: nullableStr(),
  } },
  gitlabBranch: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), default: boolSchema(), protected: boolSchema(), merged: boolSchema(), webUrl: nullableStr(),
  } },
  giteeRelease: { type: 'object', additionalProperties: false, properties: {
    tagName: strSchema(), name: nullableStr(), createdAt: nullableStr(), htmlUrl: strSchema(),
  } },
  giteeIssue: { type: 'object', additionalProperties: false, properties: {
    ident: strSchema(), title: strSchema(), state: strSchema(), user: strSchema(), comments: intSchema(), createdAt: nullableStr(), htmlUrl: strSchema(),
  } },
  giteeCommit: { type: 'object', additionalProperties: false, properties: {
    sha: strSchema(), message: strSchema(), author: nullableStr(), date: nullableStr(), htmlUrl: strSchema(),
  } },
  soAnswer: { type: 'object', additionalProperties: false, properties: {
    answerId: intSchema(), score: intSchema(), accepted: boolSchema(), author: strSchema(), createdAt: nullableStr(), link: strSchema(),
  } },
  soTag: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), count: intSchema(),
  } },
  devtoArticle: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), title: strSchema(), description: nullableStr(), publishedAt: nullableStr(), tags: { type: 'array', required: true, items: { type: 'string' } }, author: strSchema(), reactions: intSchema(), comments: intSchema(), url: strSchema(),
  } },
  devtoArticleDetail: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), title: strSchema(), description: nullableStr(), bodyMarkdown: nullableStr(), readingMinutes: intSchema(), publishedAt: nullableStr(), tags: { type: 'array', required: true, items: { type: 'string' } }, author: strSchema(), url: strSchema(),
  } },
  devtoUser: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), username: strSchema(), name: nullableStr(), summary: nullableStr(), location: nullableStr(), websiteUrl: nullableStr(), profileImage: nullableStr(), joinedAt: nullableStr(),
  } },
  npmDependencies: { type: 'object', additionalProperties: false, properties: {
    package: strSchema(), version: strSchema(), deps: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { name: strSchema(), range: strSchema() } } },
  } },
  rubygemHit: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), info: nullableStr(), version: nullableStr(), downloads: intSchema(), homepage: nullableStr(), sourceUrl: nullableStr(), projectUrl: nullableStr(), authors: nullableStr(),
  } },
  rubygemDetail: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), info: nullableStr(), version: nullableStr(), downloads: intSchema(), homepage: nullableStr(), sourceUrl: nullableStr(), documentationUrl: nullableStr(), projectUrl: nullableStr(), authors: nullableStr(), licenses: { type: 'array', required: true, items: { type: 'string' } },
  } },
  nugetHit: { type: 'object', additionalProperties: false, properties: {
    id: strSchema(), version: nullableStr(), description: nullableStr(), downloads: intSchema(), projectUrl: nullableStr(), authors: { type: 'array', required: true, items: { type: 'string' } }, tags: { type: 'array', required: true, items: { type: 'string' } },
  } },
  goModuleLatest: { type: 'object', additionalProperties: false, properties: {
    version: strSchema(), time: nullableStr(), origin: nullableStr(),
  } },
  cratesVersion: { type: 'object', additionalProperties: false, properties: {
    num: strSchema(), downloads: intSchema(), createdAt: nullableStr(), yanked: boolSchema(),
  } },
  giteeContributor: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), email: nullableStr(), contributions: intSchema(),
  } },
  gitlabTag: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), message: nullableStr(), protected: boolSchema(), sha: nullableStr(), createdAt: nullableStr(),
  } },
}

const objectSchemas: Record<string, object> = {
  languages: { type: 'object', additionalProperties: false, properties: {
    languages: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { name: strSchema(), bytes: intSchema() } } },
  } },
  readme: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), size: intSchema(), htmlUrl: strSchema(), contentText: strSchema(),
  } },
  commitCompare: { type: 'object', additionalProperties: false, properties: {
    status: strSchema(), aheadBy: intSchema(), behindBy: intSchema(), totalCommits: intSchema(), htmlUrl: strSchema(),
  } },
  communityProfile: { type: 'object', additionalProperties: false, properties: {
    healthPercentage: intSchema(), description: nullableStr(), documentation: nullableStr(),
  } },
  participation: { type: 'object', additionalProperties: false, properties: {
    all: { type: 'array', required: true, items: { type: 'integer' } },
    owner: { type: 'array', required: true, items: { type: 'integer' } },
  } },
  rateLimit: { type: 'object', additionalProperties: false, properties: {
    coreLimit: intSchema(), coreRemaining: intSchema(), coreReset: strSchema(), searchLimit: intSchema(), searchRemaining: intSchema(),
  } },
  meta: { type: 'object', additionalProperties: false, properties: {
    verifiablePasswordAuthentication: boolSchema(), apiVersion: strSchema(),
  } },
  gitignore: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), source: strSchema(),
  } },
  pages: { type: 'object', additionalProperties: false, properties: {
    status: strSchema(), cname: nullableStr(), htmlUrl: strSchema(),
  } },
  workflowRunUsage: { type: 'object', additionalProperties: false, properties: {
    totalMs: intSchema(), runStartedAt: nullableStr(),
  } },
  npmInfo: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), description: nullableStr(), latestVersion: strSchema(), license: nullableStr(), homepage: nullableStr(), repository: nullableStr(), author: nullableStr(), modified: nullableStr(),
  } },
  npmVersions: { type: 'object', additionalProperties: false, properties: {
    versions: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { version: strSchema(), publishedAt: nullableStr() } } },
  } },
  pypiProject: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), summary: nullableStr(), latestVersion: strSchema(), author: nullableStr(), license: nullableStr(), requiresPython: nullableStr(), homepage: nullableStr(), projectUrls: nullableStr(),
  } },
  pypiVersions: { type: 'object', additionalProperties: false, properties: {
    versions: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { version: strSchema(), fileCount: intSchema(), uploadDate: nullableStr() } } },
  } },
  crateInfo: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), description: nullableStr(), downloads: intSchema(), recentDownloads: intSchema(), maxVersion: nullableStr(), homepage: nullableStr(), documentation: nullableStr(), repository: nullableStr(), created: nullableStr(),
  } },
  crateDownloads: { type: 'object', additionalProperties: false, properties: {
    total: intSchema(), recent: intSchema(), version: nullableStr(),
  } },
  dockerRepo: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), description: nullableStr(), stars: intSchema(), pulls: intSchema(), lastUpdated: nullableStr(),
  } },
  hfModel: { type: 'object', additionalProperties: false, properties: {
    id: strSchema(), downloads: intSchema(), likes: intSchema(), tags: { type: 'array', required: true, items: { type: 'string' } }, pipelineTag: nullableStr(), libraryName: nullableStr(), createdAt: nullableStr(), lastModified: nullableStr(),
  } },
  soQuestionDetail: { type: 'object', additionalProperties: false, properties: {
    questionId: intSchema(), title: strSchema(), score: intSchema(), answerCount: intSchema(), tags: { type: 'array', required: true, items: { type: 'string' } }, link: strSchema(), body: strSchema(),
  } },
  redditAbout: { type: 'object', additionalProperties: false, properties: {
    subreddit: strSchema(), subscribers: intSchema(), activeUsers: intSchema(), description: nullableStr(), created: nullableStr(),
  } },
  dshEcosystemStats: { type: 'object', additionalProperties: false, properties: {
    pluginCount: intSchema(), source: strSchema(),
  } },
  npmDownloads: { type: 'object', additionalProperties: false, properties: {
    package: strSchema(), start: strSchema(), end: strSchema(), downloads: intSchema(),
  } },
  gitlabProjectDetail: { type: 'object', additionalProperties: false, properties: {
    id: intSchema(), name: strSchema(), description: nullableStr(), stars: intSchema(), forks: intSchema(), webUrl: strSchema(), defaultBranch: nullableStr(), visibility: nullableStr(), createdAt: nullableStr(), lastActivityAt: nullableStr(),
  } },
  giteeRepoDetail: { type: 'object', additionalProperties: false, properties: {
    fullName: strSchema(), description: nullableStr(), stars: intSchema(), forks: intSchema(), language: nullableStr(), license: nullableStr(), htmlUrl: strSchema(), updatedAt: nullableStr(),
  } },
  soUser: { type: 'object', additionalProperties: false, properties: {
    userId: intSchema(), displayName: strSchema(), reputation: intSchema(), location: nullableStr(), link: strSchema(), createdAt: nullableStr(),
  } },
  redditUser: { type: 'object', additionalProperties: false, properties: {
    name: strSchema(), linkKarma: intSchema(), commentKarma: intSchema(), created: nullableStr(),
  } },
}

/* ------------------------------------------------------------------ */
/* Formatters                                                          */
/* ------------------------------------------------------------------ */

const formatters: Record<string, (item: Record<string, unknown>) => string> = {
  repoHit: (i) => `${String(i.fullName)} (★${i.stars}, ${i.language ?? 'n/a'}) — ${i.description ?? ''} ${i.htmlUrl}`,
  user: (i) => `${i.login} (${i.name ?? ''}, ${i.type}) ${i.htmlUrl}`,
  starredUser: (i) => `${i.login} starred ${i.starredAt ?? '?'} ${i.htmlUrl}`,
  org: (i) => `${i.login} (${i.name ?? ''}, ${i.publicRepos} public repos) ${i.htmlUrl}`,
  release: (i) => `${i.tagName} (${i.publishedAt ?? '?'})${i.prerelease ? ' [prerelease]' : ''} ${i.htmlUrl}`,
  issue: (i) => `#${i.number} ${i.title} [${i.state}] (@${i.user}, ${i.comments} comments) ${i.htmlUrl}`,
  pull: (i) => `#${i.number} ${i.title} [${i.state}]${i.mergedAt ? ' [merged]' : ''} (@${i.user}) ${i.htmlUrl}`,
  commit: (i) => `${i.sha} ${i.message} (${i.author ?? '?'}, ${i.date ?? '?'}) ${i.htmlUrl}`,
  branch: (i) => `${i.name} (${i.sha}${i.protected ? ', protected' : ''})`,
  tag: (i) => `${i.name} (${i.sha})`,
  label: (i) => `${i.name} (#${i.color}${i.default ? ', default' : ''})${i.description ? ` — ${i.description}` : ''}`,
  milestone: (i) => `#${i.number} ${i.title} [${i.state}] ${i.openIssues} open / ${i.closedIssues} closed (${i.dueOn ?? 'no due date'}) ${i.htmlUrl}`,
  contributor: (i) => `${i.login} — ${i.contributions} contributions`,
  collaborator: (i) => `${i.login} [${i.permission}] ${i.htmlUrl}`,
  gitRef: (i) => `${i.ref} (${i.type} ${i.sha})`,
  punchCard: (i) => `day ${i.day} hour ${i.hour}: ${i.count} commits`,
  advisory: (i) => `${i.ghsaId} [${i.severity}] ${i.summary} (${i.publishedAt ?? '?'}) ${i.htmlUrl}`,
  socialAccount: (i) => `${i.provider}: ${i.url}`,
  comment: (i) => `#${i.id} @${i.user} (${i.createdAt ?? '?'}): ${String(i.body).slice(0, 120)} ${i.htmlUrl}`,
  review: (i) => `#${i.id} @${i.user} [${i.state}] (${i.submittedAt ?? '?'}) ${i.htmlUrl}`,
  fileChange: (i) => `${i.filename} [${i.status}] +${i.additions}/-${i.deletions} (${i.changes} changes)`,
  deployment: (i) => `#${i.id} ${i.ref}@${i.sha} → ${i.environment} (${i.createdAt ?? '?'}) ${i.htmlUrl}`,
  environment: (i) => `${i.name} ${i.htmlUrl}`,
  workflow: (i) => `${i.name} [${i.state}] ${i.path} ${i.htmlUrl}`,
  workflowRun: (i) => `#${i.id} ${i.name} (${i.headBranch}/${i.event}) [${i.status}${i.conclusion ? ` → ${i.conclusion}` : ''}] ${i.createdAt ?? ''} ${i.htmlUrl}`,
  job: (i) => `#${i.id} ${i.name} [${i.status}${i.conclusion ? ` → ${i.conclusion}` : ''}] ${i.htmlUrl}`,
  checkRun: (i) => `#${i.id} ${i.name} [${i.status}${i.conclusion ? ` → ${i.conclusion}` : ''}] ${i.htmlUrl}`,
  status: (i) => `${i.state} (${i.totalCount} contexts) ${i.htmlUrl}`,
  artifact: (i) => `${i.name} (${i.sizeInBytes} bytes${i.archived ? ', archived' : ''}) ${i.htmlUrl}`,
  package: (i) => `${i.name} [${i.packageType}/${i.visibility}] ${i.htmlUrl}`,
  project: (i) => `${i.name} [${i.state}] ${i.htmlUrl}`,
  treeItem: (i) => `${i.path} [${i.type}/${i.mode}] ${i.size} bytes ${i.sha}`,
  contentsItem: (i) => `${i.path} [${i.type}] ${i.size} bytes ${i.htmlUrl}`,
  event: (i) => `${i.type} by ${i.actor} on ${i.repoName} (${i.createdAt ?? '?'})`,
  gist: (i) => `${i.id} ${i.description ?? ''} (${i.fileCount} files, by ${i.owner}) ${i.htmlUrl}`,
  gistCommit: (i) => `${i.version} (${i.committedAt ?? '?'}, ${i.total} changes)`,
  weekStat: (i) => `${i.week}: +${i.additions}/-${i.deletions}`,
  commitActivity: (i) => `${i.week}: ${i.total} commits`,
  emoji: (i) => `${i.name} ${i.url}`,
  licenseInfo: (i) => `${i.name} (${i.spdxId ?? i.key}) ${i.htmlUrl}`,
  releaseAsset: (i) => `${i.name} (${i.sizeInBytes} bytes, ${i.downloadCount} downloads) ${i.browserDownloadUrl}`,
  topicHit: (i) => `${i.name} — ${i.description ?? ''} ${i.url}`,
  npmPackage: (i) => `${i.name}@${i.version} — ${i.description ?? ''} (${i.author ?? ''})`,
  npmVersion: (i) => `${i.version} (${i.publishedAt ?? '?'})`,
  crateSearchHit: (i) => `${i.name} — ${i.description ?? ''} (${i.downloads} downloads, v${i.maxVersion ?? '?'})`,
  crateVersion: (i) => `${i.num} (${i.created ?? '?'}, ${i.downloads} downloads)`,
  dockerRepoHit: (i) => `${i.name} (★${i.stars}, ${i.pulls} pulls${i.isOfficial ? ', official' : ''}) — ${i.description ?? ''}`,
  dockerTag: (i) => `${i.name} (${i.sizeBytes} bytes, ${i.lastUpdated ?? '?'})`,
  hfModelHit: (i) => `${i.id} (${i.downloads} downloads, ♥${i.likes}) [${(i.tags as string[]).join(', ')}]`,
  hfDatasetHit: (i) => `${i.id} (${i.downloads} downloads, ♥${i.likes})`,
  hfSpaceHit: (i) => `${i.id} (♥${i.likes})`,
  hnItem: (i) => `${i.title ?? i.type} (${i.score} points, ${i.comments} comments, by ${i.by ?? '?'}) ${i.url ?? `item/${i.id}`}`,
  hnUser: (i) => `${i.id} (karma ${i.karma}, since ${i.created ?? '?'})`,
  soQuestion: (i) => `#${i.questionId} ${i.title} (${i.score} votes, ${i.answerCount} answers${i.isAnswered ? ', answered' : ''}) [${(i.tags as string[]).join(', ')}] ${i.link}`,
  redditPost: (i) => `r/${i.subreddit}: ${i.title} (${i.score} pts, ${i.numComments} comments, u/${i.author}) ${i.permalink || i.url}`,
  gitlabProject: (i) => `${i.nameWithNamespace || i.name} (★${i.stars}, ${i.forks} forks) — ${i.description ?? ''} ${i.webUrl}`,
  giteeRepo: (i) => `${i.fullName} (★${i.stars}, ${i.forks} forks, ${i.language ?? 'n/a'}) — ${i.description ?? ''} ${i.htmlUrl}`,
  deploymentStatus: (i) => `#${i.id} [${i.state}] ${i.environment ?? ''} (${i.createdAt ?? '?'}) ${i.description ?? ''} ${i.htmlUrl}`,
  pagesBuild: (i) => `#${i.id} [${i.status}]${i.error ? ` error: ${i.error}` : ''} ${i.createdAt ?? '?'} ${i.htmlUrl}`,
  contributorStats: (i) => `${i.author} — ${i.total} commits`,
  fileContent: (i) => `${i.path} (${i.size} bytes) ${i.htmlUrl}\n${String(i.contentText).slice(0, 600)}`,
}

function formatItem(type: string, item: unknown): string {
  const formatter = formatters[type]
  if (formatter === undefined) return JSON.stringify(item)
  return formatter(item as Record<string, unknown>)
}

const objectFormatters: Record<string, (item: Record<string, unknown>) => string> = {
  languages: (i) => (i.languages as unknown[]).slice(0, 10).map((l) => `${(l as Record<string, unknown>).name}: ${(l as Record<string, unknown>).bytes} bytes`).join(' · '),
  readme: (i) => `${i.name} (${i.size} bytes) ${i.htmlUrl}\n${String(i.contentText).slice(0, 800)}`,
  commitCompare: (i) => `${i.status} — ahead ${i.aheadBy}, behind ${i.behindBy}, ${i.totalCommits} commits ${i.htmlUrl}`,
  communityProfile: (i) => `Health ${i.healthPercentage}% — ${i.description ?? ''} · docs: ${i.documentation ?? 'n/a'}`,
  participation: (i) => `All-time commits: ${(i.all as number[]).slice(-12).join(', ')} · Owner commits: ${(i.owner as number[]).slice(-12).join(', ')}`,
  rateLimit: (i) => `core ${i.coreRemaining}/${i.coreLimit} (resets ${i.coreReset}) · search ${i.searchRemaining}/${i.searchLimit}`,
  meta: (i) => `API ${i.apiVersion} · password auth ${i.verifiablePasswordAuthentication}`,
  gitignore: (i) => `${i.name}\n${String(i.source).slice(0, 400)}`,
  pages: (i) => `${i.status}${i.cname ? ` · ${i.cname}` : ''} ${i.htmlUrl}`,
  workflowRunUsage: (i) => `${i.totalMs} ms total${i.runStartedAt ? `, started ${i.runStartedAt}` : ''}`,
  npmInfo: (i) => `${i.name}@${i.latestVersion} — ${i.description ?? ''} · author: ${i.author ?? ''} · license: ${i.license ?? ''} · modified: ${i.modified ?? ''}\n${i.homepage ?? ''}${i.repository ? ` · repo: ${i.repository}` : ''}`,
  npmVersions: (i) => (i.versions as unknown[]).slice(0, 10).map((v) => `${(v as Record<string, unknown>).version} (${(v as Record<string, unknown>).publishedAt ?? '?'})`).join('\n'),
  pypiProject: (i) => `${i.name} ${i.latestVersion} — ${i.summary ?? ''} · author: ${i.author ?? ''} · license: ${i.license ?? ''} · requires: ${i.requiresPython ?? 'any'}\n${i.homepage ?? ''}`,
  pypiVersions: (i) => (i.versions as unknown[]).slice(0, 10).map((v) => `${(v as Record<string, unknown>).version} (${(v as Record<string, unknown>).uploadDate ?? '?'}, ${(v as Record<string, unknown>).fileCount} files)`).join('\n'),
  crateInfo: (i) => `${i.name} ${i.maxVersion ?? ''} — ${i.description ?? ''} · ${i.downloads} total downloads (${i.recentDownloads} recent) · created ${i.created ?? ''}\n${i.homepage ?? ''} ${i.repository ?? ''}`,
  crateDownloads: (i) => `${i.total} total, ${i.recent} recent downloads${i.version ? ` (v${i.version})` : ''}`,
  dockerRepo: (i) => `${i.name} — ${i.description ?? ''} · ★${i.stars} · ${i.pulls} pulls · updated ${i.lastUpdated ?? '?'}`,
  hfModel: (i) => `${i.id} — ${i.downloads} downloads, ♥${i.likes} · pipeline: ${i.pipelineTag ?? '?'} · library: ${i.libraryName ?? '?'}\n[${(i.tags as string[]).join(', ')}]`,
  soQuestionDetail: (i) => `#${i.questionId} ${i.title} (${i.score} votes, ${i.answerCount} answers)\n${i.body}`,
  redditAbout: (i) => `r/${i.subreddit} — ${i.subscribers} subscribers, ${i.activeUsers} active · ${i.description ?? ''} · created ${i.created ?? '?'}`,
  dshEcosystemStats: (i) => `${i.pluginCount} plugins tracked by ${i.source}`,
  npmDownloads: (i) => `${i.package}: ${i.downloads} downloads (${i.start} → ${i.end})`,
  gitlabProjectDetail: (i) => `${i.name} (★${i.stars}, ${i.forks} forks, ${i.visibility ?? '?'}) — ${i.description ?? ''}\n${i.webUrl}`,
  giteeRepoDetail: (i) => `${i.fullName} (★${i.stars}, ${i.forks} forks, ${i.language ?? 'n/a'}, ${i.license ?? 'n/a'}) — ${i.description ?? ''}\n${i.htmlUrl}`,
  gitlabIssue: (i) => `!${i.iid} ${i.title} [${i.state}] (@${i.author}, ${i.comments} comments) ${i.webUrl}`,
  gitlabMr: (i) => `!${i.iid} ${i.title} [${i.state}]${i.mergedAt ? ' [merged]' : ''} (@${i.author}) ${i.webUrl}`,
  gitlabCommit: (i) => `${i.sha} ${i.title} (${i.author ?? '?'}, ${i.date ?? '?'}) ${i.webUrl ?? ''}`,
  gitlabBranch: (i) => `${i.name}${i.default ? ' [default]' : ''}${i.protected ? ' [protected]' : ''} ${i.webUrl ?? ''}`,
  giteeRelease: (i) => `${i.tagName} (${i.createdAt ?? '?'}) ${i.htmlUrl}`,
  giteeIssue: (i) => `#${i.ident} ${i.title} [${i.state}] (@${i.user}, ${i.comments} comments) ${i.htmlUrl}`,
  giteeCommit: (i) => `${i.sha} ${i.message} (${i.author ?? '?'}, ${i.date ?? '?'}) ${i.htmlUrl}`,
  soAnswer: (i) => `#${i.answerId} ${i.accepted ? '[accepted] ' : ''}(${i.score} votes, @${i.author}, ${i.createdAt ?? '?'}) ${i.link}`,
  soTag: (i) => `${i.name} (${i.count} questions)`,
  devtoArticle: (i) => `${i.title} [${i.reactions} reactions, ${i.comments} comments] by @${i.author} (${i.publishedAt ?? '?'})\n${i.url}`,
  devtoArticleDetail: (i) => `${i.title} (${i.readingMinutes} min read, by @${i.author}, ${i.publishedAt ?? '?'})\n${i.description ?? ''}\n${i.url}`,
  devtoUser: (i) => `@${i.username} (${i.name ?? ''}) — ${i.summary ?? ''}${i.location ? ` · ${i.location}` : ''} ${i.websiteUrl ?? ''}`,
  npmDependencies: (i) => `${i.package}@${i.version} dependencies:\n${(i.deps as Array<Record<string, unknown>>).slice(0, 20).map((d) => `- ${d.name}@${d.range}`).join('\n')}`,
  rubygemHit: (i) => `${i.name} (${i.version ?? '?'}, ${i.downloads} downloads) — ${i.info ?? ''} ${i.projectUrl ?? ''}`,
  rubygemDetail: (i) => `${i.name} ${i.version} (${i.downloads} downloads) — ${i.info ?? ''}\nauthors: ${i.authors ?? 'n/a'} · licenses: ${(i.licenses as string[]).join(', ') || 'n/a'}\n${i.homepage ?? ''} ${i.projectUrl ?? ''}`,
  nugetHit: (i) => `${i.id} (${i.version ?? '?'}, ${i.downloads} downloads) — ${i.description ?? ''} ${i.projectUrl ?? ''}`,
  goModuleLatest: (i) => `${i.version} (${i.time ?? '?'})${i.origin ? ` · origin: ${i.origin}` : ''}`,
  cratesVersion: (i) => `${i.num} (${i.downloads} downloads, ${i.createdAt ?? '?'})${i.yanked ? ' [yanked]' : ''}`,
  giteeContributor: (i) => `${i.name} — ${i.contributions} contributions`,
  gitlabTag: (i) => `${i.name} (${i.sha ?? '?'})${i.protected ? ' [protected]' : ''} ${i.message ?? ''}`,
  soUser: (i) => `${i.displayName} (reputation ${i.reputation}${i.location ? `, ${i.location}` : ''}) ${i.link}`,
  redditUser: (i) => `u/${i.name} (${i.linkKarma} link karma, ${i.commentKarma} comment karma, since ${i.created ?? '?'})`,
}

function formatObject(type: string, item: unknown): string {
  const formatter = objectFormatters[type]
  if (formatter === undefined) return JSON.stringify(item)
  return formatter(item as Record<string, unknown>)
}

/* ------------------------------------------------------------------ */
/* The catalog                                                         */
/* ------------------------------------------------------------------ */

const L = (spec: ToolSpec): ToolSpec => spec

export const catalog: ToolSpec[] = [
  // repo metadata & content
  L({ name: 'github_repo_languages', description: 'Language breakdown of a repository by bytes, largest first.', kind: 'object', itemType: 'languages', path: '/repos/{owner}/{repo}/languages' }),
  L({ name: 'github_repo_topics', description: 'Topics of a public repository.', kind: 'string-list', path: '/repos/{owner}/{repo}/topics', params: {}, example: 'agent, ai, harness' }),
  L({ name: 'github_repo_license', description: 'License information and license text of a repository.', kind: 'object', itemType: 'licenseInfo', path: '/repos/{owner}/{repo}/license' }),
  L({ name: 'github_repo_readme', description: 'README of a repository, decoded to plain text (bounded).', kind: 'object', itemType: 'readme', path: '/repos/{owner}/{repo}/readme' }),
  L({ name: 'github_repo_contents', description: 'Top-level file and directory listing of a repository.', kind: 'list', itemType: 'contentsItem', path: '/repos/{owner}/{repo}/contents' }),
  L({ name: 'github_repo_tree', description: 'Git tree entries of a repository at a ref or SHA.', kind: 'list', itemType: 'treeItem', path: '/repos/{owner}/{repo}/git/trees/{ref}', params: { recursive: { type: 'number', description: '1 to fetch recursively.' } } }),
  L({ name: 'github_repo_commits', description: 'Recent commits of a repository.', kind: 'list', itemType: 'commit', path: '/repos/{owner}/{repo}/commits', params: { limit: { type: 'number', description: 'How many commits (1-50).' } } }),
  L({ name: 'github_repo_commit', description: 'A single commit by SHA.', kind: 'object', itemType: 'commit', path: '/repos/{owner}/{repo}/commits/{sha}' }),
  L({ name: 'github_repo_commit_comments', description: 'Comments on commits of a repository.', kind: 'list', itemType: 'comment', path: '/repos/{owner}/{repo}/comments', params: { limit: { type: 'number', description: 'How many comments (1-50).' } } }),
  L({ name: 'github_repo_branches', description: 'Branches of a repository.', kind: 'list', itemType: 'branch', path: '/repos/{owner}/{repo}/branches', params: { limit: { type: 'number', description: 'How many branches (1-50).' } } }),
  L({ name: 'github_repo_branch', description: 'A single branch by name.', kind: 'object', itemType: 'branch', path: '/repos/{owner}/{repo}/branches/{branch}' }),
  L({ name: 'github_repo_tags', description: 'Git tags of a repository.', kind: 'list', itemType: 'tag', path: '/repos/{owner}/{repo}/tags', params: { limit: { type: 'number', description: 'How many tags (1-50).' } } }),
  L({ name: 'github_repo_compare_commits', description: 'Compare two refs of a repository: ahead/behind counts and status.', kind: 'object', itemType: 'commitCompare', path: '/repos/{owner}/{repo}/compare/{base}...{head}' }),
  L({ name: 'github_repo_community_profile', description: 'Community health profile of a repository.', kind: 'object', itemType: 'communityProfile', path: '/repos/{owner}/{repo}/community/profile' }),
  L({ name: 'github_repo_stats_code_frequency', description: 'Weekly additions/deletions for the last year.', kind: 'list', itemType: 'weekStat', path: '/repos/{owner}/{repo}/stats/code_frequency' }),
  L({ name: 'github_repo_stats_commit_activity', description: 'Weekly commit activity for the last year.', kind: 'list', itemType: 'commitActivity', path: '/repos/{owner}/{repo}/stats/commit_activity' }),
  L({ name: 'github_repo_stats_participation', description: 'Total vs owner commit participation over 52 weeks.', kind: 'object', itemType: 'participation', path: '/repos/{owner}/{repo}/stats/participation' }),
  // releases
  L({ name: 'github_repo_release_by_tag', description: 'A release by its tag name.', kind: 'object', itemType: 'release', path: '/repos/{owner}/{repo}/releases/tags/{tag}' }),
  L({ name: 'github_repo_release_by_id', description: 'A release by numeric id.', kind: 'object', itemType: 'release', path: '/repos/{owner}/{repo}/releases/{releaseId}' }),
  L({ name: 'github_repo_release_assets', description: 'Binary assets attached to a release.', kind: 'list', itemType: 'releaseAsset', path: '/repos/{owner}/{repo}/releases/{releaseId}/assets' }),
  L({ name: 'github_repo_releases_latest', description: 'The latest non-prerelease release.', kind: 'object', itemType: 'release', path: '/repos/{owner}/{repo}/releases/latest' }),
  L({ name: 'github_repo_releases', description: 'Recent releases of a repository, newest first (including prereleases).', kind: 'list', itemType: 'release', path: '/repos/{owner}/{repo}/releases', params: { limit: { type: 'number', description: 'How many releases (1-50).' } } }),
  // issues
  L({ name: 'github_repo_issue', description: 'A single issue by number.', kind: 'object', itemType: 'issue', path: '/repos/{owner}/{repo}/issues/{number}' }),
  L({ name: 'github_repo_issues', description: 'Issues of a repository (GitHub also returns pull requests in this list).', kind: 'list', itemType: 'issue', path: '/repos/{owner}/{repo}/issues', params: { state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state.' }, limit: { type: 'number', description: 'How many issues (1-50).' } } }),
  L({ name: 'github_repo_issue_comments', description: 'Comments on a single issue.', kind: 'list', itemType: 'comment', path: '/repos/{owner}/{repo}/issues/{number}/comments', params: { limit: { type: 'number', description: 'How many comments (1-50).' } } }),
  L({ name: 'github_repo_issue_events', description: 'Timeline events of a single issue (labeled, closed, referenced...).', kind: 'list', itemType: 'event', path: '/repos/{owner}/{repo}/issues/{number}/events', params: { limit: { type: 'number', description: 'How many events (1-50).' } } }),
  L({ name: 'github_repo_labels', description: 'Labels of a repository.', kind: 'list', itemType: 'label', path: '/repos/{owner}/{repo}/labels', params: { limit: { type: 'number', description: 'How many labels (1-50).' } } }),
  L({ name: 'github_repo_label', description: 'A single label by name.', kind: 'object', itemType: 'label', path: '/repos/{owner}/{repo}/labels/{name}' }),
  L({ name: 'github_repo_milestones', description: 'Milestones of a repository.', kind: 'list', itemType: 'milestone', path: '/repos/{owner}/{repo}/milestones', params: { state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Milestone state.' }, limit: { type: 'number', description: 'How many milestones (1-50).' } } }),
  L({ name: 'github_repo_milestone', description: 'A single milestone by number.', kind: 'object', itemType: 'milestone', path: '/repos/{owner}/{repo}/milestones/{number}' }),
  // pulls
  L({ name: 'github_repo_pull', description: 'A single pull request by number.', kind: 'object', itemType: 'pull', path: '/repos/{owner}/{repo}/pulls/{number}' }),
  L({ name: 'github_repo_pulls', description: 'Pull requests of a repository.', kind: 'list', itemType: 'pull', path: '/repos/{owner}/{repo}/pulls', params: { state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Pull request state.' }, limit: { type: 'number', description: 'How many pull requests (1-50).' } } }),
  L({ name: 'github_repo_pull_commits', description: 'Commits on a pull request.', kind: 'list', itemType: 'commit', path: '/repos/{owner}/{repo}/pulls/{number}/commits', params: { limit: { type: 'number', description: 'How many commits (1-50).' } } }),
  L({ name: 'github_repo_pull_files', description: 'Files changed in a pull request.', kind: 'list', itemType: 'fileChange', path: '/repos/{owner}/{repo}/pulls/{number}/files', params: { limit: { type: 'number', description: 'How many files (1-50).' } } }),
  L({ name: 'github_repo_pull_reviews', description: 'Reviews submitted on a pull request.', kind: 'list', itemType: 'review', path: '/repos/{owner}/{repo}/pulls/{number}/reviews', params: { limit: { type: 'number', description: 'How many reviews (1-50).' } } }),
  L({ name: 'github_repo_pull_review_comments', description: 'Inline review comments on a pull request.', kind: 'list', itemType: 'comment', path: '/repos/{owner}/{repo}/pulls/{number}/comments', params: { limit: { type: 'number', description: 'How many comments (1-50).' } } }),
  // activity
  L({ name: 'github_repo_forks', description: 'Forks of a repository, newest first.', kind: 'list', itemType: 'repoHit', path: '/repos/{owner}/{repo}/forks', params: { sort: { type: 'string', enum: ['newest', 'oldest', 'stargazers'], description: 'Sort order.' }, limit: { type: 'number', description: 'How many forks (1-50).' } } }),
  L({ name: 'github_repo_stargazers', description: 'Users who starred a repository, with star dates.', kind: 'list', itemType: 'starredUser', path: '/repos/{owner}/{repo}/stargazers', params: { limit: { type: 'number', description: 'How many stargazers (1-50).' } } }),
  L({ name: 'github_repo_watchers', description: 'Users watching a repository.', kind: 'list', itemType: 'user', path: '/repos/{owner}/{repo}/subscribers', params: { limit: { type: 'number', description: 'How many watchers (1-50).' } } }),
  L({ name: 'github_repo_events', description: 'Recent events on a repository (pushes, issues, releases...).', kind: 'list', itemType: 'event', path: '/repos/{owner}/{repo}/events', params: { limit: { type: 'number', description: 'How many events (1-50).' } } }),
  // deployments & actions
  L({ name: 'github_repo_deployments', description: 'Deployments of a repository.', kind: 'list', itemType: 'deployment', path: '/repos/{owner}/{repo}/deployments', params: { limit: { type: 'number', description: 'How many deployments (1-50).' } } }),
  L({ name: 'github_repo_deployment', description: 'A single deployment by id.', kind: 'object', itemType: 'deployment', path: '/repos/{owner}/{repo}/deployments/{deploymentId}' }),
  L({ name: 'github_repo_environments', description: 'Deployment environments of a repository.', kind: 'list', itemType: 'environment', path: '/repos/{owner}/{repo}/environments', params: { limit: { type: 'number', description: 'How many environments (1-50).' } } }),
  L({ name: 'github_repo_environment', description: 'A single environment by name.', kind: 'object', itemType: 'environment', path: '/repos/{owner}/{repo}/environments/{environment}' }),
  L({ name: 'github_repo_workflows', description: 'GitHub Actions workflows of a repository.', kind: 'list', itemType: 'workflow', path: '/repos/{owner}/{repo}/actions/workflows', params: { limit: { type: 'number', description: 'How many workflows (1-50).' } } }),
  L({ name: 'github_repo_workflow', description: 'A single workflow by id.', kind: 'object', itemType: 'workflow', path: '/repos/{owner}/{repo}/actions/workflows/{workflowId}' }),
  L({ name: 'github_repo_workflow_runs', description: 'Recent workflow runs of a repository.', kind: 'list', itemType: 'workflowRun', path: '/repos/{owner}/{repo}/actions/runs', params: { limit: { type: 'number', description: 'How many runs (1-50).' }, status: { type: 'string', description: 'Filter by status/conclusion.' } } }),
  L({ name: 'github_repo_workflow_run', description: 'A single workflow run by id.', kind: 'object', itemType: 'workflowRun', path: '/repos/{owner}/{repo}/actions/runs/{runId}' }),
  L({ name: 'github_repo_workflow_run_jobs', description: 'Jobs of a workflow run.', kind: 'list', itemType: 'job', path: '/repos/{owner}/{repo}/actions/runs/{runId}/jobs', params: { limit: { type: 'number', description: 'How many jobs (1-50).' } } }),
  L({ name: 'github_repo_artifacts', description: 'Build artifacts of a repository.', kind: 'list', itemType: 'artifact', path: '/repos/{owner}/{repo}/actions/artifacts', params: { limit: { type: 'number', description: 'How many artifacts (1-50).' } } }),
  L({ name: 'github_repo_artifact', description: 'A single artifact by id.', kind: 'object', itemType: 'artifact', path: '/repos/{owner}/{repo}/actions/artifacts/{artifactId}' }),
  // checks & statuses
  L({ name: 'github_repo_check_runs', description: 'Check runs for a commit ref.', kind: 'list', itemType: 'checkRun', path: '/repos/{owner}/{repo}/commits/{ref}/check-runs', params: { limit: { type: 'number', description: 'How many check runs (1-50).' } } }),
  L({ name: 'github_repo_check_run', description: 'A single check run by id.', kind: 'object', itemType: 'checkRun', path: '/repos/{owner}/{repo}/check-runs/{checkRunId}' }),
  L({ name: 'github_repo_commit_statuses', description: 'Commit statuses for a ref.', kind: 'list', itemType: 'status', path: '/repos/{owner}/{repo}/commits/{ref}/statuses', params: { limit: { type: 'number', description: 'How many statuses (1-50).' } } }),
  L({ name: 'github_repo_combined_status', description: 'Combined commit status for a ref.', kind: 'object', itemType: 'status', path: '/repos/{owner}/{repo}/commits/{ref}/status' }),
  // pages
  L({ name: 'github_repo_pages', description: 'GitHub Pages site configuration of a repository.', kind: 'object', itemType: 'pages', path: '/repos/{owner}/{repo}/pages' }),
  // search
  L({ name: 'github_search_issues', description: 'Search issues across GitHub with search syntax.', kind: 'list', itemType: 'issue', path: '/search/issues', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', description: 'How many results (1-50).' } }, example: 'q=repo:deepseek-ai/deepseek-harness is:open' }),
  L({ name: 'github_search_pulls', description: 'Search pull requests across GitHub with search syntax.', kind: 'list', itemType: 'pull', path: '/search/issues', params: { q: { type: 'string', required: true, description: 'Search query (add is:pr).' }, limit: { type: 'number', description: 'How many results (1-50).' } } }),
  L({ name: 'github_search_commits', description: 'Search commits across GitHub with search syntax.', kind: 'list', itemType: 'commit', path: '/search/commits', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', description: 'How many results (1-50).' } } }),
  L({ name: 'github_search_users', description: 'Search GitHub users with search syntax.', kind: 'list', itemType: 'user', path: '/search/users', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', description: 'How many results (1-50).' } } }),
  L({ name: 'github_search_topics', description: 'Search GitHub topics.', kind: 'list', itemType: 'topicHit', path: '/search/topics', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', description: 'How many results (1-50).' } } }),
  L({ name: 'github_search_labels', description: 'Search repository labels.', kind: 'list', itemType: 'label', path: '/search/labels', params: { repository_id: { type: 'number', required: true, description: 'Numeric repository id.' }, q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', description: 'How many results (1-50).' } } }),
  L({ name: 'github_search_code', description: 'Search code across GitHub (requires a configured githubToken).', kind: 'list', itemType: 'repoHit', path: '/search/code', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', description: 'How many results (1-50).' } }, authNote: 'Code search requires authentication; configure githubToken.' }),
  L({ name: 'github_search_repositories', description: 'Search public repositories across GitHub with search syntax.', kind: 'list', itemType: 'repoHit', path: '/search/repositories', wrap: 'items', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', description: 'How many results (1-50).' } } }),
  // users
  L({ name: 'github_user', description: 'Public profile of a GitHub user.', kind: 'object', itemType: 'user', path: '/users/{username}' }),
  L({ name: 'github_user_starred', description: 'Repositories a user has starred.', kind: 'list', itemType: 'repoHit', path: '/users/{username}/starred', params: { limit: { type: 'number', description: 'How many repositories (1-50).' } } }),
  L({ name: 'github_user_repositories', description: 'Repositories owned by a user.', kind: 'list', itemType: 'repoHit', path: '/users/{username}/repos', params: { limit: { type: 'number', description: 'How many repositories (1-50).' } } }),
  L({ name: 'github_user_social_accounts', description: 'Public social accounts linked to a user.', kind: 'list', itemType: 'socialAccount', path: '/users/{username}/social_accounts', params: { limit: { type: 'number', description: 'How many accounts (1-50).' } } }),
  L({ name: 'github_user_followers', description: 'Followers of a user.', kind: 'list', itemType: 'user', path: '/users/{username}/followers', params: { limit: { type: 'number', description: 'How many followers (1-50).' } } }),
  L({ name: 'github_user_following', description: 'Users a user follows.', kind: 'list', itemType: 'user', path: '/users/{username}/following', params: { limit: { type: 'number', description: 'How many users (1-50).' } } }),
  L({ name: 'github_user_gists', description: 'Public gists of a user.', kind: 'list', itemType: 'gist', path: '/users/{username}/gists', params: { limit: { type: 'number', description: 'How many gists (1-50).' } } }),
  L({ name: 'github_user_orgs', description: 'Organizations a user belongs to.', kind: 'list', itemType: 'org', path: '/users/{username}/orgs', params: { limit: { type: 'number', description: 'How many organizations (1-50).' } } }),
  L({ name: 'github_user_events', description: 'Events performed by a user.', kind: 'list', itemType: 'event', path: '/users/{username}/events', params: { limit: { type: 'number', description: 'How many events (1-50).' } } }),
  L({ name: 'github_user_received_events', description: 'Events received by a user.', kind: 'list', itemType: 'event', path: '/users/{username}/received_events', params: { limit: { type: 'number', description: 'How many events (1-50).' } } }),
  // orgs
  L({ name: 'github_org', description: 'Public profile of an organization.', kind: 'object', itemType: 'org', path: '/orgs/{org}' }),
  L({ name: 'github_org_repos', description: 'Repositories of an organization.', kind: 'list', itemType: 'repoHit', path: '/orgs/{org}/repos', params: { type: { type: 'string', enum: ['all', 'public', 'member'], description: 'Repository type.' }, limit: { type: 'number', description: 'How many repositories (1-50).' } } }),
  L({ name: 'github_org_members', description: 'Public members of an organization.', kind: 'list', itemType: 'user', path: '/orgs/{org}/public_members', params: { limit: { type: 'number', description: 'How many members (1-50).' } } }),
  L({ name: 'github_org_events', description: 'Recent events in an organization.', kind: 'list', itemType: 'event', path: '/orgs/{org}/events', params: { limit: { type: 'number', description: 'How many events (1-50).' } } }),
  L({ name: 'github_org_packages', description: 'Packages of an organization.', kind: 'list', itemType: 'package', path: '/orgs/{org}/packages', params: { package_type: { type: 'string', enum: ['npm', 'maven', 'rubygems', 'docker', 'nuget', 'container'], description: 'Package type.' }, limit: { type: 'number', description: 'How many packages (1-50).' } } }),
  L({ name: 'github_org_projects', description: 'Projects of an organization.', kind: 'list', itemType: 'project', path: '/orgs/{org}/projects', params: { limit: { type: 'number', description: 'How many projects (1-50).' } } }),
  // gists
  L({ name: 'github_gists', description: 'Recently created public gists.', kind: 'list', itemType: 'gist', path: '/gists/public', params: { limit: { type: 'number', description: 'How many gists (1-50).' } } }),
  L({ name: 'github_gist', description: 'A single gist by id.', kind: 'object', itemType: 'gist', path: '/gists/{gistId}' }),
  L({ name: 'github_gist_comments', description: 'Comments on a gist.', kind: 'list', itemType: 'comment', path: '/gists/{gistId}/comments', params: { limit: { type: 'number', description: 'How many comments (1-50).' } } }),
  L({ name: 'github_gist_forks', description: 'Forks of a gist.', kind: 'list', itemType: 'user', path: '/gists/{gistId}/forks', params: { limit: { type: 'number', description: 'How many forks (1-50).' } } }),
  L({ name: 'github_gist_commits', description: 'Revision history of a gist.', kind: 'list', itemType: 'gistCommit', path: '/gists/{gistId}/commits', params: { limit: { type: 'number', description: 'How many revisions (1-50).' } } }),
  // platform
  L({ name: 'github_licenses', description: 'List of common open-source licenses.', kind: 'list', itemType: 'licenseInfo', path: '/licenses' }),
  L({ name: 'github_license', description: 'Details of a license by SPDX key (e.g. MIT, Apache-2.0).', kind: 'object', itemType: 'licenseInfo', path: '/licenses/{key}' }),
  L({ name: 'github_gitignore_templates', description: 'Available .gitignore template names.', kind: 'string-list', path: '/gitignore/templates' }),
  L({ name: 'github_gitignore_template', description: 'A .gitignore template by name.', kind: 'object', itemType: 'gitignore', path: '/gitignore/templates/{name}' }),
  L({ name: 'github_rate_limit', description: 'Current GitHub API rate limit status (core and search).', kind: 'object', itemType: 'rateLimit', path: '/rate_limit' }),
  L({ name: 'github_meta', description: 'GitHub API metadata (version, features).', kind: 'object', itemType: 'meta', path: '/meta' }),
  L({ name: 'github_emojis', description: 'GitHub emoji shortcodes and image URLs.', kind: 'list', itemType: 'emoji', path: '/emojis' }),
  L({ name: 'github_zen', description: 'A random Zen quote from GitHub.', kind: 'text', path: '/zen' }),
  L({ name: 'github_events_public', description: 'Recently triggered public events across GitHub.', kind: 'list', itemType: 'event', path: '/events', params: { limit: { type: 'number', description: 'How many events (1-50).' } } }),
  L({ name: 'github_user_packages', description: 'Packages published by a user (may require a token for some scopes).', kind: 'list', itemType: 'package', path: '/users/{username}/packages', params: { package_type: { type: 'string', enum: ['npm', 'maven', 'rubygems', 'docker', 'nuget', 'container'], description: 'Package type.' }, limit: { type: 'number', description: 'How many packages (1-50).' } }, authNote: 'Some package types require authentication.' }),
  L({ name: 'github_search_packages', description: 'Search packages across GitHub (requires a configured githubToken).', kind: 'list', itemType: 'package', path: '/search/packages', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', description: 'How many results (1-50).' } }, authNote: 'Package search requires authentication; configure githubToken.' }),
  L({ name: 'github_repo_workflow_run_usage', description: 'Billed execution time of a workflow run.', kind: 'object', itemType: 'workflowRunUsage', path: '/repos/{owner}/{repo}/actions/runs/{runId}/timing' }),
  // npm
  L({ name: 'npm_search', description: 'Search npm packages by keyword.', kind: 'list', itemType: 'npmPackage', baseUrl: 'https://registry.npmjs.org', path: '/-/v1/search', wrap: 'objects', params: { q: { type: 'string', required: true, description: 'Search query.' }, size: { type: 'number', default: 10, description: 'How many results (1-50).' } } }),
  L({ name: 'npm_package', description: 'Metadata of an npm package: description, latest version, license, author, repository.', kind: 'object', itemType: 'npmInfo', baseUrl: 'https://registry.npmjs.org', path: '/{package}' }),
  L({ name: 'npm_package_versions', description: 'Version history of an npm package with publish dates.', kind: 'object', itemType: 'npmVersions', baseUrl: 'https://registry.npmjs.org', path: '/{package}' }),
  L({ name: 'npm_downloads_last_week', description: 'Download counts of an npm package over the last week.', kind: 'object', itemType: 'npmDownloads', baseUrl: 'https://api.npmjs.org', path: '/downloads/point/last-week/{package}' }),
  L({ name: 'npm_downloads_last_month', description: 'Download counts of an npm package over the last month.', kind: 'object', itemType: 'npmDownloads', baseUrl: 'https://api.npmjs.org', path: '/downloads/point/last-month/{package}' }),
  L({ name: 'npm_package_dependencies', description: 'Direct runtime dependencies of an npm package at its latest version.', kind: 'object', itemType: 'npmDependencies', baseUrl: 'https://registry.npmjs.org', path: '/{package}' }),
  // rubygems
  L({ name: 'rubygems_search', description: 'Search RubyGems packages by name or keyword.', kind: 'list', itemType: 'rubygemHit', baseUrl: 'https://rubygems.org/api/v1', path: '/search.json', params: { query: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', default: 5, description: 'How many gems (1-50).' } } }),
  L({ name: 'rubygems_gem', description: 'Details of a RubyGem by exact name: version, downloads, licenses, homepage, source.', kind: 'object', itemType: 'rubygemDetail', baseUrl: 'https://rubygems.org/api/v1', path: '/gems/{gem}.json' }),
  // nuget
  L({ name: 'nuget_search', description: 'Search NuGet packages by id or keyword.', kind: 'list', itemType: 'nugetHit', baseUrl: 'https://azuresearch-usnc.nuget.org', path: '/query', wrap: 'data', params: { q: { type: 'string', required: true, description: 'Search query.' }, take: { type: 'number', default: 5, description: 'How many packages (1-50).' } } }),
  // go proxy
  L({ name: 'go_module_latest', description: 'Latest released version of a Go module from the official Go module proxy.', kind: 'object', itemType: 'goModuleLatest', baseUrl: 'https://proxy.golang.org', path: '/{module}/@latest' }),
  // PyPI
  L({ name: 'pypi_project', description: 'Metadata of a PyPI project: summary, latest version, author, license, Python requirement.', kind: 'object', itemType: 'pypiProject', baseUrl: 'https://pypi.org/pypi', path: '/{package}/json' }),
  L({ name: 'pypi_versions', description: 'Version history of a PyPI project with upload dates and file counts.', kind: 'object', itemType: 'pypiVersions', baseUrl: 'https://pypi.org/pypi', path: '/{package}/json' }),
  // crates.io
  L({ name: 'crates_search', description: 'Search Rust crates on crates.io.', kind: 'list', itemType: 'crateSearchHit', baseUrl: 'https://crates.io/api/v1', path: '/crates', wrap: 'crates', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', default: 5, description: 'How many results (1-50).' } } }),
  L({ name: 'crates_crate', description: 'Details of a Rust crate: downloads, recent downloads, latest version, links.', kind: 'object', itemType: 'crateInfo', baseUrl: 'https://crates.io/api/v1', path: '/crates/{crate}', wrap: 'crate' }),
  L({ name: 'crates_crate_versions', description: 'Version history of a Rust crate with per-version downloads and yank status.', kind: 'list', itemType: 'cratesVersion', baseUrl: 'https://crates.io/api/v1', path: '/crates/{crate}', wrap: 'versions', params: { limit: { type: 'number', default: 10, description: 'How many versions (1-50).' } } }),
  L({ name: 'crates_versions', description: 'Version history of a Rust crate.', kind: 'list', itemType: 'crateVersion', baseUrl: 'https://crates.io/api/v1', path: '/crates/{crate}/versions', wrap: 'versions', params: { limit: { type: 'number', default: 5, description: 'How many versions (1-50).' } } }),
  L({ name: 'crates_downloads', description: 'Download totals of a Rust crate.', kind: 'object', itemType: 'crateDownloads', baseUrl: 'https://crates.io/api/v1', path: '/crates/{crate}/downloads' }),
  // Docker Hub
  L({ name: 'docker_search', description: 'Search Docker Hub repositories.', kind: 'list', itemType: 'dockerRepoHit', baseUrl: 'https://hub.docker.com/v2', path: '/search/repositories/', wrap: 'results', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', default: 5, description: 'How many results (1-50).' } } }),
  L({ name: 'docker_repo', description: 'Details of a Docker Hub repository: stars, pulls, description, last update.', kind: 'object', itemType: 'dockerRepo', baseUrl: 'https://hub.docker.com/v2', path: '/repositories/{namespace}/{repository}/', wrap: 'data' }),
  L({ name: 'docker_repo_tags', description: 'Image tags of a Docker Hub repository.', kind: 'list', itemType: 'dockerTag', baseUrl: 'https://hub.docker.com/v2', path: '/repositories/{namespace}/{repository}/tags/', wrap: 'results', params: { limit: { type: 'number', default: 5, description: 'How many tags (1-50).' } } }),
  // Hugging Face
  L({ name: 'hf_models', description: 'Search Hugging Face models, sorted by downloads.', kind: 'list', itemType: 'hfModelHit', baseUrl: 'https://huggingface.co/api', path: '/models', params: { search: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', default: 5, description: 'How many models (1-50).' } } }),
  L({ name: 'hf_model', description: 'Details of a Hugging Face model: downloads, likes, tags, pipeline, library.', kind: 'object', itemType: 'hfModel', baseUrl: 'https://huggingface.co/api', path: '/models/{modelId}' }),
  L({ name: 'hf_datasets', description: 'Search Hugging Face datasets.', kind: 'list', itemType: 'hfDatasetHit', baseUrl: 'https://huggingface.co/api', path: '/datasets', params: { search: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', default: 5, description: 'How many datasets (1-50).' } } }),
  L({ name: 'hf_spaces', description: 'Search Hugging Face Spaces.', kind: 'list', itemType: 'hfSpaceHit', baseUrl: 'https://huggingface.co/api', path: '/spaces', params: { search: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', default: 5, description: 'How many spaces (1-50).' } } }),
  // Hacker News
  L({ name: 'hn_top', description: 'Top stories on Hacker News right now, with scores and comments.', kind: 'list', itemType: 'hnItem', baseUrl: 'https://hacker-news.firebaseio.com/v0', path: '/topstories.json', params: { limit: { type: 'number', default: 5, description: 'How many stories (1-20).' } } }),
  L({ name: 'hn_new', description: 'Newest stories on Hacker News, with scores and comments.', kind: 'list', itemType: 'hnItem', baseUrl: 'https://hacker-news.firebaseio.com/v0', path: '/newstories.json', params: { limit: { type: 'number', default: 5, description: 'How many stories (1-20).' } } }),
  L({ name: 'hn_ask', description: 'Latest Ask HN posts.', kind: 'list', itemType: 'hnItem', baseUrl: 'https://hacker-news.firebaseio.com/v0', path: '/askstories.json', params: { limit: { type: 'number', default: 5, description: 'How many stories (1-20).' } } }),
  L({ name: 'hn_item', description: 'A single Hacker News item (story or comment) by id.', kind: 'object', itemType: 'hnItem', baseUrl: 'https://hacker-news.firebaseio.com/v0', path: '/item/{itemId}.json' }),
  L({ name: 'hn_user', description: 'A Hacker News user profile by username.', kind: 'object', itemType: 'hnUser', baseUrl: 'https://hacker-news.firebaseio.com/v0', path: '/user/{username}.json' }),
  // Stack Overflow
  L({ name: 'so_search', description: 'Search Stack Overflow questions by keywords.', kind: 'list', itemType: 'soQuestion', baseUrl: 'https://api.stackexchange.com/2.3', path: '/search', wrap: 'items', params: { q: { type: 'string', required: true, description: 'Search keywords (intitle).' }, site: { type: 'string', default: 'stackoverflow', description: 'Stack Exchange site.' }, limit: { type: 'number', default: 5, description: 'How many questions (1-50).' } } }),
  L({ name: 'so_questions_by_tag', description: 'Top-voted Stack Overflow questions for a tag.', kind: 'list', itemType: 'soQuestion', baseUrl: 'https://api.stackexchange.com/2.3', path: '/questions', wrap: 'items', params: { tagged: { type: 'string', required: true, description: 'Tag, e.g. typescript.' }, site: { type: 'string', default: 'stackoverflow', description: 'Stack Exchange site.' }, limit: { type: 'number', default: 5, description: 'How many questions (1-50).' } } }),
  L({ name: 'so_question', description: 'A Stack Overflow question by id with its body text.', kind: 'object', itemType: 'soQuestionDetail', baseUrl: 'https://api.stackexchange.com/2.3', path: '/questions/{questionId}', wrap: 'items', params: { site: { type: 'string', default: 'stackoverflow', description: 'Stack Exchange site.' } } }),
  L({ name: 'so_question_answers', description: 'Top-voted answers to a Stack Overflow question.', kind: 'list', itemType: 'soAnswer', baseUrl: 'https://api.stackexchange.com/2.3', path: '/questions/{questionId}/answers', wrap: 'items', params: { site: { type: 'string', default: 'stackoverflow', description: 'Stack Exchange site.' }, limit: { type: 'number', default: 5, description: 'How many answers (1-50).' } } }),
  L({ name: 'so_top_tags', description: 'Most popular Stack Overflow tags by question count.', kind: 'list', itemType: 'soTag', baseUrl: 'https://api.stackexchange.com/2.3', path: '/tags', wrap: 'items', params: { site: { type: 'string', default: 'stackoverflow', description: 'Stack Exchange site.' }, limit: { type: 'number', default: 10, description: 'How many tags (1-50).' } } }),
  L({ name: 'so_related_tags', description: 'Tags related to a Stack Overflow tag.', kind: 'list', itemType: 'soTag', baseUrl: 'https://api.stackexchange.com/2.3', path: '/tags/{tag}/related', wrap: 'items', params: { site: { type: 'string', default: 'stackoverflow', description: 'Stack Exchange site.' }, limit: { type: 'number', default: 10, description: 'How many tags (1-50).' } } }),
  // Reddit
  L({ name: 'reddit_subreddit_hot', description: 'Hot posts of a subreddit.', kind: 'list', itemType: 'redditPost', baseUrl: 'https://www.reddit.com', path: '/r/{subreddit}/hot.json', wrap: 'children', params: { limit: { type: 'number', default: 5, description: 'How many posts (1-25).' } } }),
  L({ name: 'reddit_subreddit_new', description: 'Newest posts of a subreddit.', kind: 'list', itemType: 'redditPost', baseUrl: 'https://www.reddit.com', path: '/r/{subreddit}/new.json', wrap: 'children', params: { limit: { type: 'number', default: 5, description: 'How many posts (1-25).' } } }),
  L({ name: 'reddit_subreddit_top', description: 'Top posts of a subreddit.', kind: 'list', itemType: 'redditPost', baseUrl: 'https://www.reddit.com', path: '/r/{subreddit}/top.json', wrap: 'children', params: { limit: { type: 'number', default: 5, description: 'How many posts (1-25).' } } }),
  L({ name: 'reddit_subreddit_about', description: 'Subreddit stats: subscribers, active users, description.', kind: 'object', itemType: 'redditAbout', baseUrl: 'https://www.reddit.com', path: '/r/{subreddit}/about.json', wrap: 'data' }),
  L({ name: 'reddit_subreddit_rising', description: 'Rising posts of a subreddit.', kind: 'list', itemType: 'redditPost', baseUrl: 'https://www.reddit.com', path: '/r/{subreddit}/rising.json', wrap: 'children', params: { limit: { type: 'number', default: 5, description: 'How many posts (1-25).' } } }),
  L({ name: 'reddit_subreddit_controversial', description: 'Controversial posts of a subreddit.', kind: 'list', itemType: 'redditPost', baseUrl: 'https://www.reddit.com', path: '/r/{subreddit}/controversial.json', wrap: 'children', params: { limit: { type: 'number', default: 5, description: 'How many posts (1-25).' } } }),
  L({ name: 'reddit_search', description: 'Search Reddit posts across all subreddits.', kind: 'list', itemType: 'redditPost', baseUrl: 'https://www.reddit.com', path: '/search.json', wrap: 'children', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', default: 5, description: 'How many posts (1-25).' } } }),
  // dsh ecosystem itself
  L({ name: 'dsh_ecosystem_stats', description: 'Current number of plugins tracked by the awesome-dsh-plugin registry.', kind: 'object', itemType: 'dshEcosystemStats', baseUrl: 'https://awesome-dsh-plugin.com', path: '/count.json' }),
  // GitLab
  L({ name: 'gitlab_search', description: 'Search projects on GitLab.com.', kind: 'list', itemType: 'gitlabProject', baseUrl: 'https://gitlab.com/api/v4', path: '/projects', params: { q: { type: 'string', required: true, description: 'Search query.' }, limit: { type: 'number', default: 5, description: 'How many projects (1-50).' } } }),
  L({ name: 'gitlab_project', description: 'Details of a GitLab project by numeric id.', kind: 'object', itemType: 'gitlabProjectDetail', baseUrl: 'https://gitlab.com/api/v4', path: '/projects/{projectId}' }),
  L({ name: 'gitlab_group_projects', description: 'Projects of a GitLab group.', kind: 'list', itemType: 'gitlabProject', baseUrl: 'https://gitlab.com/api/v4', path: '/groups/{group}/projects', params: { limit: { type: 'number', default: 5, description: 'How many projects (1-50).' } } }),
  L({ name: 'gitlab_project_issues', description: 'Issues of a GitLab project (use a path id like gitlab-org/gitlab).', kind: 'list', itemType: 'gitlabIssue', baseUrl: 'https://gitlab.com/api/v4', path: '/projects/{projectId}/issues', params: { state: { type: 'string', enum: ['opened', 'closed', 'all'], description: 'Issue state.' }, limit: { type: 'number', default: 5, description: 'How many issues (1-50).' } } }),
  L({ name: 'gitlab_project_merge_requests', description: 'Merge requests of a GitLab project.', kind: 'list', itemType: 'gitlabMr', baseUrl: 'https://gitlab.com/api/v4', path: '/projects/{projectId}/merge_requests', params: { state: { type: 'string', enum: ['opened', 'closed', 'merged', 'all'], description: 'Merge request state.' }, limit: { type: 'number', default: 5, description: 'How many merge requests (1-50).' } } }),
  L({ name: 'gitlab_project_commits', description: 'Recent commits of a GitLab project.', kind: 'list', itemType: 'gitlabCommit', baseUrl: 'https://gitlab.com/api/v4', path: '/projects/{projectId}/repository/commits', params: { limit: { type: 'number', default: 5, description: 'How many commits (1-50).' } } }),
  L({ name: 'gitlab_project_branches', description: 'Branches of a GitLab project.', kind: 'list', itemType: 'gitlabBranch', baseUrl: 'https://gitlab.com/api/v4', path: '/projects/{projectId}/repository/branches', params: { limit: { type: 'number', default: 5, description: 'How many branches (1-50).' } } }),
  L({ name: 'gitlab_project_tags', description: 'Tags of a GitLab project.', kind: 'list', itemType: 'gitlabTag', baseUrl: 'https://gitlab.com/api/v4', path: '/projects/{projectId}/repository/tags', params: { limit: { type: 'number', default: 5, description: 'How many tags (1-50).' } } }),
  // Gitee
  L({ name: 'gitee_search', description: 'Search repositories on Gitee (Chinese developer platform).', kind: 'list', itemType: 'giteeRepo', baseUrl: 'https://gitee.com/api/v5', path: '/search/repositories', params: { q: { type: 'string', required: true, description: 'Search query.' }, per_page: { type: 'number', default: 5, description: 'How many repositories (1-50).' } } }),
  L({ name: 'gitee_repo', description: 'Details of a Gitee repository.', kind: 'object', itemType: 'giteeRepoDetail', baseUrl: 'https://gitee.com/api/v5', path: '/repos/{owner}/{repo}' }),
  L({ name: 'gitee_user_repos', description: 'Repositories of a Gitee user.', kind: 'list', itemType: 'giteeRepo', baseUrl: 'https://gitee.com/api/v5', path: '/users/{username}/repos', params: { per_page: { type: 'number', default: 5, description: 'How many repositories (1-50).' } } }),
  L({ name: 'gitee_repo_releases', description: 'Releases of a Gitee repository.', kind: 'list', itemType: 'giteeRelease', baseUrl: 'https://gitee.com/api/v5', path: '/repos/{owner}/{repo}/releases', params: { per_page: { type: 'number', default: 5, description: 'How many releases (1-50).' } } }),
  L({ name: 'gitee_repo_issues', description: 'Issues of a Gitee repository.', kind: 'list', itemType: 'giteeIssue', baseUrl: 'https://gitee.com/api/v5', path: '/repos/{owner}/{repo}/issues', params: { state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state.' }, per_page: { type: 'number', default: 5, description: 'How many issues (1-50).' } } }),
  L({ name: 'gitee_repo_commits', description: 'Recent commits of a Gitee repository.', kind: 'list', itemType: 'giteeCommit', baseUrl: 'https://gitee.com/api/v5', path: '/repos/{owner}/{repo}/commits', params: { per_page: { type: 'number', default: 5, description: 'How many commits (1-50).' } } }),
  L({ name: 'gitee_repo_contributors', description: 'Contributors of a Gitee repository by commit count.', kind: 'list', itemType: 'giteeContributor', baseUrl: 'https://gitee.com/api/v5', path: '/repos/{owner}/{repo}/contributors', params: { per_page: { type: 'number', default: 5, description: 'How many contributors (1-50).' } } }),
  // GitHub: comments, deployments, pages, stats, content
  L({ name: 'github_repo_commit_comment', description: 'A single commit comment by id.', kind: 'object', itemType: 'comment', path: '/repos/{owner}/{repo}/comments/{commentId}' }),
  L({ name: 'github_repo_issue_comment', description: 'A single issue comment by id.', kind: 'object', itemType: 'comment', path: '/repos/{owner}/{repo}/issues/comments/{commentId}' }),
  L({ name: 'github_repo_pull_review', description: 'A single pull request review by id.', kind: 'object', itemType: 'review', path: '/repos/{owner}/{repo}/pulls/{number}/reviews/{reviewId}' }),
  L({ name: 'github_repo_release_asset', description: 'A single release asset by id.', kind: 'object', itemType: 'releaseAsset', path: '/repos/{owner}/{repo}/releases/assets/{assetId}' }),
  L({ name: 'github_repo_deployment_statuses', description: 'Statuses of a deployment.', kind: 'list', itemType: 'deploymentStatus', path: '/repos/{owner}/{repo}/deployments/{deploymentId}/statuses', params: { limit: { type: 'number', default: 5, description: 'How many statuses (1-50).' } } }),
  L({ name: 'github_repo_deployment_status', description: 'A single deployment status by id.', kind: 'object', itemType: 'deploymentStatus', path: '/repos/{owner}/{repo}/deployments/{deploymentId}/statuses/{statusId}' }),
  L({ name: 'github_repo_pages_builds', description: 'GitHub Pages build history of a repository.', kind: 'list', itemType: 'pagesBuild', path: '/repos/{owner}/{repo}/pages/builds', params: { limit: { type: 'number', default: 5, description: 'How many builds (1-50).' } } }),
  L({ name: 'github_repo_contributors_stats', description: 'Commit totals per contributor over the repository lifetime.', kind: 'list', itemType: 'contributorStats', path: '/repos/{owner}/{repo}/stats/contributors', params: { limit: { type: 'number', default: 10, description: 'How many contributors (1-50).' } } }),
  L({ name: 'github_repo_contributors', description: 'Contributors of a repository by commit count.', kind: 'list', itemType: 'contributor', path: '/repos/{owner}/{repo}/contributors', params: { limit: { type: 'number', description: 'How many contributors (1-50).' } } }),
  L({ name: 'github_repo_subscribers', description: 'Users watching a repository.', kind: 'list', itemType: 'user', path: '/repos/{owner}/{repo}/subscribers', params: { limit: { type: 'number', description: 'How many subscribers (1-50).' } } }),
  L({ name: 'github_repo_collaborators', description: 'Collaborators of a repository with their effective permission.', kind: 'list', itemType: 'collaborator', path: '/repos/{owner}/{repo}/collaborators', params: { limit: { type: 'number', description: 'How many collaborators (1-50).' } }, authNote: 'Requires a token with push access to the repository.' }),
  L({ name: 'github_repo_git_refs', description: 'Git refs of a repository matching a prefix (e.g. heads, tags).', kind: 'list', itemType: 'gitRef', path: '/repos/{owner}/{repo}/git/matching-refs/{ref}', params: { limit: { type: 'number', description: 'How many refs (1-50).' } }, example: 'ref=heads/main' }),
  L({ name: 'github_repo_punch_card', description: 'Commit counts by day of week and hour (punch card).', kind: 'list', itemType: 'punchCard', path: '/repos/{owner}/{repo}/stats/punch_card' }),
  L({ name: 'github_repo_security_advisories', description: 'Security advisories of a repository (GHSA).', kind: 'list', itemType: 'advisory', path: '/repos/{owner}/{repo}/security-advisories', params: { limit: { type: 'number', description: 'How many advisories (1-50).' } } }),
  L({ name: 'github_repo_issue_timeline', description: 'Timeline events of a single issue.', kind: 'list', itemType: 'event', path: '/repos/{owner}/{repo}/issues/{number}/timeline', params: { limit: { type: 'number', default: 5, description: 'How many events (1-50).' } } }),
  L({ name: 'github_repo_contents_path', description: 'File and directory listing at a path in a repository.', kind: 'list', itemType: 'contentsItem', path: '/repos/{owner}/{repo}/contents/{path}' }),
  L({ name: 'github_repo_file_content', description: 'A single file from a repository, decoded to plain text (bounded).', kind: 'object', itemType: 'fileContent', path: '/repos/{owner}/{repo}/contents/{path}' }),
  L({ name: 'github_repo_commits_by_author', description: 'Commits of a repository by author login.', kind: 'list', itemType: 'commit', path: '/repos/{owner}/{repo}/commits', params: { author: { type: 'string', required: true, description: 'GitHub login of the author.' }, limit: { type: 'number', default: 5, description: 'How many commits (1-50).' } } }),
  L({ name: 'github_repo_commits_by_path', description: 'Commits of a repository touching a file path.', kind: 'list', itemType: 'commit', path: '/repos/{owner}/{repo}/commits', params: { path: { type: 'string', required: true, description: 'File path in the repository.' }, limit: { type: 'number', default: 5, description: 'How many commits (1-50).' } } }),
  L({ name: 'github_repo_commit_comments_by_ref', description: 'Comments on commits at a ref.', kind: 'list', itemType: 'comment', path: '/repos/{owner}/{repo}/commits/{ref}/comments', params: { limit: { type: 'number', default: 5, description: 'How many comments (1-50).' } } }),
  // Hacker News extras
  L({ name: 'hn_show', description: 'Latest Show HN posts.', kind: 'list', itemType: 'hnItem', baseUrl: 'https://hacker-news.firebaseio.com/v0', path: '/showstories.json', params: { limit: { type: 'number', default: 5, description: 'How many stories (1-20).' } } }),
  L({ name: 'hn_job', description: 'Latest job posts on Hacker News.', kind: 'list', itemType: 'hnItem', baseUrl: 'https://hacker-news.firebaseio.com/v0', path: '/jobstories.json', params: { limit: { type: 'number', default: 5, description: 'How many jobs (1-20).' } } }),
  L({ name: 'hn_best', description: 'Highest-scoring stories on Hacker News right now.', kind: 'list', itemType: 'hnItem', baseUrl: 'https://hacker-news.firebaseio.com/v0', path: '/beststories.json', params: { limit: { type: 'number', default: 5, description: 'How many stories (1-20).' } } }),
  // Stack Overflow / Reddit / crates extras
  L({ name: 'so_user', description: 'A Stack Overflow user profile by id.', kind: 'object', itemType: 'soUser', baseUrl: 'https://api.stackexchange.com/2.3', path: '/users/{userId}', wrap: 'items', params: { site: { type: 'string', default: 'stackoverflow', description: 'Stack Exchange site.' } } }),
  L({ name: 'reddit_user', description: 'A Reddit user profile by username.', kind: 'object', itemType: 'redditUser', baseUrl: 'https://www.reddit.com', path: '/user/{username}/about.json', wrap: 'data' }),
  // dev.to
  L({ name: 'devto_articles', description: 'Recent dev.to articles, optionally filtered by tag or top-of-week.', kind: 'list', itemType: 'devtoArticle', baseUrl: 'https://dev.to/api', path: '/articles', params: { tag: { type: 'string', description: 'Filter by tag, e.g. javascript.' }, top: { type: 'number', description: '1-7: top articles of the period.' }, per_page: { type: 'number', default: 5, description: 'How many articles (1-50).' } } }),
  L({ name: 'devto_article', description: 'A dev.to article by id with full markdown body.', kind: 'object', itemType: 'devtoArticleDetail', baseUrl: 'https://dev.to/api', path: '/articles/{articleId}' }),
  L({ name: 'devto_user', description: 'A dev.to user profile by id.', kind: 'object', itemType: 'devtoUser', baseUrl: 'https://dev.to/api', path: '/users/{userId}' }),
  L({ name: 'crates_owners', description: 'Owners of a Rust crate.', kind: 'list', itemType: 'user', baseUrl: 'https://crates.io/api/v1', path: '/crates/{crate}/owners', wrap: 'users', params: { limit: { type: 'number', default: 5, description: 'How many owners (1-50).' } } }),
]

/* ------------------------------------------------------------------ */
/* Generator                                                           */
/* ------------------------------------------------------------------ */

function paramFromPath(path: string): string[] {
  const names: string[] = []
  for (const match of path.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    const name = match[1]
    if (name !== undefined && !names.includes(name)) names.push(name)
  }
  return names
}

function schemaFor(type: string): object {
  const schema = itemSchemas[type]
  if (schema === undefined) throw new Error(`catalog: no schema for item type ${type}`)
  return schema
}

function listSchema(type: string): object {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: { type: 'string', required: true },
      itemType: { type: 'string', required: true },
      items: { type: 'array', required: true, items: schemaFor(type) },
    },
  }
}

function objectSchema(type: string): object {
  const schema = objectSchemas[type] ?? itemSchemas[type]
  if (schema === undefined) throw new Error(`catalog: no object schema for ${type}`)
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: { type: 'string', required: true },
      itemType: { type: 'string', required: true },
      item: schema,
    },
  }
}

function stringListSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: { type: 'string', required: true },
      itemType: { type: 'string', required: true },
      items: { type: 'array', required: true, items: { type: 'string' } },
    },
  }
}

function textSchema(): object {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      source: { type: 'string', required: true },
      itemType: { type: 'string', required: true },
      text: { type: 'string', required: true },
    },
  }
}

function renderList(spec: ToolSpec) {
  return (_args: Record<string, unknown>, value: { source: string; items: unknown[] }): Array<{ type: 'text'; text: string }> => {
    if (value.items.length === 0) return [{ type: 'text', text: `No results for ${value.source}.` }]
    const type = spec.itemType ?? 'item'
    return [{ type: 'text', text: `${value.source} (${value.items.length} results):\n` + value.items.map((item) => `- ${formatItem(type, item)}`).join('\n') }]
  }
}

function renderObject(spec: ToolSpec) {
  return (_args: Record<string, unknown>, value: { source: string; item: unknown }): Array<{ type: 'text'; text: string }> => {
    const type = spec.itemType ?? 'item'
    const formatter = objectFormatters[type] ?? formatters[type]
    const text = formatter !== undefined ? formatter(value.item as Record<string, unknown>) : JSON.stringify(value.item)
    return [{ type: 'text', text: `${value.source}:\n${text}` }]
  }
}

function renderStringList() {
  return (_args: Record<string, unknown>, value: { source: string; items: string[] }): Array<{ type: 'text'; text: string }> => {
    return [{ type: 'text', text: `${value.source}: ${value.items.join(', ')}` }]
  }
}

function renderText() {
  return (_args: Record<string, unknown>, value: { source: string; text: string }): Array<{ type: 'text'; text: string }> => {
    return [{ type: 'text', text: value.text }]
  }
}

function outputSchema(spec: ToolSpec): object {
  if (spec.kind === 'list') return listSchema(spec.itemType ?? 'repoHit')
  if (spec.kind === 'object') return objectSchema(spec.itemType ?? 'readme')
  if (spec.kind === 'string-list') return stringListSchema()
  return textSchema()
}

function renderFor(spec: ToolSpec): (args: Record<string, unknown>, value: never) => Array<{ type: 'text'; text: string }> {
  if (spec.kind === 'list') return renderList(spec) as never
  if (spec.kind === 'object') return renderObject(spec) as never
  if (spec.kind === 'string-list') return renderStringList() as never
  return renderText() as never
}

function buildPath(spec: ToolSpec, args: Record<string, unknown>): string {
  let path = spec.path
  for (const match of path.matchAll(/\{([a-zA-Z0-9_]+)\}/g)) {
    const name = match[1]
    if (name !== undefined) {
      const value = String(args[name] ?? '')
      if (value === '') throw new Error(`catalog: missing required parameter ${name} for ${spec.name}`)
      path = path.replace(`{${name}}`, encodeURIComponent(value))
    }
  }
  const query = new URLSearchParams()
  for (const [key, param] of Object.entries(spec.params ?? {})) {
    if (param.default !== undefined && args[key] === undefined) query.set(key, String(param.default))
    if (args[key] !== undefined) query.set(key, String(args[key]))
  }
  const qs = query.toString()
  return qs === '' ? path : `${path}?${qs}`
}

function parametersFor(spec: ToolSpec): Record<string, unknown> {
  const parameters: Record<string, unknown> = {}
  for (const name of paramFromPath(spec.path)) {
    parameters[name] = { type: 'string', required: true, description: `Path parameter ${name}.` }
  }
  for (const [key, param] of Object.entries(spec.params ?? {})) {
    const specParam: Record<string, unknown> = { type: param.type, description: param.description }
    if (param.required) specParam.required = true
    if (param.enum !== undefined) specParam.enum = [...param.enum]
    parameters[key] = specParam
  }
  return parameters
}

function sourceFor(spec: ToolSpec, args: Record<string, unknown>): string {
  if (args.owner !== undefined && args.repo !== undefined) return `${args.owner}/${args.repo}`
  if (args.username !== undefined) return `@${args.username}`
  if (args.org !== undefined) return `org:${args.org}`
  if (args.gistId !== undefined) return `gist:${args.gistId}`
  if (args.query !== undefined) return `query: ${args.query}`
  if (args.q !== undefined) return `query: ${args.q}`
  return spec.name
}

/** Build one generated tool definition from a catalog spec. */
export function buildCatalogTool(fetcher: Fetcher, spec: ToolSpec) {
  const pathParams = paramFromPath(spec.path)
  const limitParam = spec.params?.limit
  const defaultLimit = typeof limitParam?.default === 'number' ? limitParam.default : 5

  const execute = async (args: Record<string, unknown>, exec: { signal: AbortSignal }): Promise<unknown> => {
    const path = buildPath(spec, args)
    const raw = await fetcher(path, exec.signal, path)
    const source = sourceFor(spec, args)
    if (spec.kind === 'list') {
      const itemType = spec.itemType ?? 'repoHit'
      if (spec.name.startsWith('hn_') && itemType === 'hnItem' && spec.name !== 'hn_item') {
        const ids = (raw as unknown[]).slice(0, clamp(Number(args.limit ?? spec.params?.limit?.default ?? 5), 1, 20))
        const items = await Promise.all(ids.map((id) => fetcher(`/item/${id}.json`, exec.signal, `hn-item-${id}`)))
        return { source, itemType, items: items.map((entry) => parseItem(itemType, entry)) }
      }
      if (spec.name === 'github_emojis') {
        const entries = Object.entries(raw as Record<string, unknown>).slice(0, 50)
        return { source, itemType, items: entries.map(([key, value]) => parseItem(itemType, value, key)) }
      }
      const unwrapped = unwrap(raw, spec.wrap)
      const payload = unwrapped as Record<string, unknown>
      const data = Array.isArray(unwrapped) ? unwrapped : Array.isArray(payload.items) ? payload.items : []
      // Enforce `limit` locally: some APIs (GitHub, GitLab, StackExchange)
      // ignore a `limit` query param and return their own default page size.
      const limitSpec = spec.params?.limit
      const limit = limitSpec !== undefined ? clamp(Number(args.limit ?? limitSpec.default ?? 5), 1, 50) : undefined
      const bounded = limit !== undefined ? data.slice(0, limit) : data
      if (spec.name === 'github_search_issues') {
        const filtered = bounded.filter((entry) => (entry as Record<string, unknown>).pull_request === undefined)
        return { source, itemType, items: filtered.map((entry) => parseItem(itemType, entry)) }
      }
      if (spec.name === 'github_search_pulls') {
        const filtered = bounded.filter((entry) => (entry as Record<string, unknown>).pull_request !== undefined)
        return { source, itemType, items: filtered.map((entry) => parseItem(itemType, entry)) }
      }
      if (spec.name === 'github_repo_issues') {
        const filtered = bounded.filter((entry) => (entry as Record<string, unknown>).pull_request === undefined)
        return { source, itemType, items: filtered.map((entry) => parseItem(itemType, entry)) }
      }
      if (spec.name === 'github_search_topics') {
        return { source, itemType: 'topicHit', items: bounded.map((entry) => parseItem('topicHit', entry)) }
      }
      if (spec.name === 'github_search_code') {
        return { source, itemType: 'repoHit', items: bounded.map((entry) => {
          const r = entry as Record<string, unknown>
          const repo = r.repository as Record<string, unknown> | null
          return {
            fullName: repo !== null && typeof repo === 'object' ? String(repo.full_name ?? '') : '',
            description: (r.name ?? null) as string | null,
            stars: 0,
            language: null,
            updatedAt: null,
            htmlUrl: String(r.html_url ?? ''),
          }
        }) }
      }
      return { source, itemType, items: bounded.map((entry) => parseItem(itemType, entry)) }
    }
    if (spec.kind === 'string-list') {
      return { source, itemType: 'string', items: raw as string[] }
    }
    if (spec.kind === 'text') {
      return { source, itemType: 'text', text: String(raw) }
    }
    const type = spec.itemType ?? 'readme'
    const unwrapped = unwrap(raw, spec.wrap)
    const target = Array.isArray(unwrapped) ? unwrapped[0] : unwrapped
    const item = objectParsers[type] !== undefined ? parseObject(type, target) : parseItem(type, target)
    return { source, itemType: type, item }
  }

  return defineTool({
    name: spec.name,
    description: spec.description + (spec.authNote !== undefined ? ` ${spec.authNote}` : '') + (spec.example !== undefined ? ` Example: ${spec.example}` : ''),
    parameters: parametersFor(spec) as never,
    output: {
      schema: outputSchema(spec) as never,
      render: renderFor(spec) as never,
    },
    execute: execute as never,
    presentCall: (args) => ({ card: 'generic', title: spec.name, kind: 'search', rawInput: args }),
  })
}

/** Build every generated tool. */
export function buildCatalogTools(fetcher: Fetcher) {
  return catalog.map((spec) => buildCatalogTool(fetcher, spec))
}

/** Registry for the model: what tools exist and what they do. */
export function buildHelpTool(count: number) {
  const entries = catalog.map((spec) => ({
    name: spec.name,
    description: spec.description,
    example: spec.example ?? null,
  }))
  return defineTool({
    name: 'github_help',
    description:
      `List the ${count} available tools (github_*, gitlab_*, gitee_*, npm_*, pypi_*, crates_*, `
      + `docker_*, hf_*, hn_*, so_*, reddit_*, devto_*, rubygems_*, nuget_*) with one-line descriptions. Call this first when the user asks `
      + 'about any developer platform and you are unsure which tool to use.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          total: { type: 'integer', required: true },
          tools: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
                example: { oneOf: [{ type: 'string' }, { type: 'null' }], required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Available GitHub tools (${value.total}):\n` + value.tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n'),
      }],
    },
    async execute() {
      return { total: count, tools: entries }
    },
    presentCall: () => ({ card: 'generic', title: 'GitHub tool catalog', kind: 'search' }),
  })
}
