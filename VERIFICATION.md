# Verification Record

Date: 2026-08-15 · Environment: Windows, Node 24.19.0 (bundled runtime), pnpm 11.19.0, dsh CLI 0.1.0-rc.6

## 1. TypeScript build

```sh
pnpm run build
```

Result: `tsc -p tsconfig.json` exits 0, emits `lib/` with `index.js`, `github.js`, and type declarations.

## 2. Unit tests

```sh
pnpm test
```

Result: 3 test files, 44 tests, all passed. Coverage includes extended repo parsing, issue/PR filtering, contributors, commits, TTL caching, rate-limit/404 errors, registration of 195+ tools, the deep report + weekly digest (including 404 tolerance for PR-disabled repositories), catalog completeness (unique names, 100+ tool floor), generated-tool execution (GitHub lists, npm search unwrapping, Hacker News item resolution, ecosystem stats, GitLab/Gitee, file content, the v2.3.0..v2.8.0 tool sets, local limit enforcement, SO site param), and input validation.

In addition, every v2.3.0 tool passed a real-network smoke against the public GitHub API (scripts/v230-network-smoke.mjs): `github_user_repositories`, `github_user_social_accounts`, `github_repo_releases`, `github_repo_issues`, `github_repo_pulls`, `github_repo_contributors`, `github_repo_subscribers`, `github_repo_collaborators`, `github_repo_git_refs`, `github_repo_punch_card` (168 punches), `github_repo_security_advisories`, and `github_search_repositories`.

The v2.4.0 smoke (scripts/v240-network-smoke.mjs) covers all 27 v2.3.0 + v2.4.0 tools against their real public APIs (GitHub, GitLab, Gitee, npm, Stack Exchange, dev.to; Reddit skipped on networks that block it): 25/25 passed on this machine, including `so_question_answers` (5 real answers), `so_top_tags` (10 real tags), `gitlab_project_*` (5 each), `npm_package_dependencies` (real dependency list), and dev.to article/user. The smoke also verified the `limit` fix: GitHub list tools now return exactly the requested count instead of the API's default page.

The v2.5.0 smoke (scripts/v250-network-smoke.mjs) extends that to 30 tools: `rubygems_search` and `rubygems_gem` against the real RubyGems API, and `nuget_search` against the real NuGet search service. Bitbucket Cloud was probed but not shipped: its public API now returns 404/410 for anonymous access (probe-v240b-era finding, re-verified 2026-08-15).

The v2.6.0 smoke (scripts/v260-network-smoke.mjs) extends that to 35 tools: `crates_crate_versions` against crates.io, `gitee_repo_contributors`, `gitlab_project_tags`, and `so_related_tags` all passed against real APIs. `go_module_latest` was verified against the official Go module proxy via a urllib probe (response `{Version, Time}`), but Node fetch from this network intermittently cannot reach proxy.golang.org, so it is reported as SKIP here. Maven Central (repeated timeouts) and Hugging Face `/api/tags` (401) were probed and rejected.

The v2.7.0 `github_weekly_digest` was executed against the real GitHub API on `deepseek-ai/deepseek-harness` (14-day window): 30 commits returned, releases/issues/pulls surfaces tolerated (the repository has pull requests and issues disabled). A unit test covers the 404-tolerance path.

The v2.8.0 smoke (scripts/v280-network-smoke.mjs) extends that to 37 tools: `npm_downloads_last_day` and `npm_downloads_range` passed against the real npm downloads API (lodash, 8 daily points). Stack Exchange `/search/answers` (HTTP 400), the crates.io dependencies endpoint (unreachable from this network), and dev.to podcast episodes (unreachable) were probed and rejected.

## 3. Package and install into a dsh profile

```sh
pnpm pack
dsh plugin --profile web add ./dsh-github-intelligence-1.0.0.tgz
```

Result: package added to the `web` profile; `dsh --profile web --dump-config` shows the `github-intelligence` layer after `@deepseek-ai/dsh-base`.

## 4. Boot the web app with the plugin loaded

```sh
dsh web --port 4111
```

Result: `dsh web: http://127.0.0.1:4111`; `GET /` returns HTTP 200. No plugin load errors. All seven tools register during `apply()`; a schema/registration failure would abort boot.
