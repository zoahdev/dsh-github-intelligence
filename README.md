# dsh-github-intelligence

[![CI](https://github.com/zoahdev/dsh-github-intelligence/actions/workflows/ci.yml/badge.svg)](https://github.com/zoahdev/dsh-github-intelligence/actions) [![Release](https://img.shields.io/github/v/release/zoahdev/dsh-github-intelligence)](https://github.com/zoahdev/dsh-github-intelligence/releases) [![npm](https://img.shields.io/npm/v/dsh-github-intelligence)](https://www.npmjs.com/package/dsh-github-intelligence)

[English](#english) · [中文](#中文)

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![CI](https://img.shields.io/github/actions/workflow/status/zoahdev/dsh-github-intelligence/ci.yml?branch=main)](https://github.com/zoahdev/dsh-github-intelligence/actions)
[![Release](https://img.shields.io/github/v/release/zoahdev/dsh-github-intelligence)](https://github.com/zoahdev/dsh-github-intelligence/releases)

**Developer intelligence for DeepSeek Harness: 201 read-only tools across GitHub, 16 external ecosystems, and the dsh registry itself** — now with an authenticated maintainer inbox and evidence-based repository health audits. Public tools need no API key; every request supports cancellation, rate-limit-friendly TTL caching, and UI cards.

> Topic: [`dsh-plugin`](https://github.com/topics/dsh-plugin) · Tested with `dsh` 0.1.0-rc.6 · Node 24 / pnpm 11

**Live tool catalog:** https://zoahdev.github.io/dsh-github-intelligence/

**Featured in:** [awesome-dsh-plugin](https://awesome-dsh-plugin.com) (4k★ list) · [awesome-deepseek-harness](https://github.com/0xsline/awesome-deepseek-harness) (562★ list) · [official Show & Tell #1657](https://github.com/deepseek-ai/deepseek-harness/discussions/1657)

## Tools

| Tool | What it does |
|---|---|
| `github_repo` | Full repo overview: stars, forks, issues, language, license, topics, default branch, archived status, activity dates |
| `github_releases` | Recent releases with tag, date, pre-release flag, URL, body preview |
| `github_issues` | Recent issues by state (open/closed/all) — pull requests excluded automatically |
| `github_pulls` | Recent pull requests by state, including merge status |
| `github_contributors` | Top contributors by commit count |
| `github_search` | Repository search sorted by stars or last update |
| `github_repo_report` | One-shot deep report: overview + latest release + open issues + recent commits + top contributors |
| `github_compare` | Side-by-side comparison of two repositories with numeric deltas |
| `github_trending` | Recently created repositories sorted by stars (optional language filter) |
| `github_user_repos` | A user's top repositories by stars |
| `github_weekly_digest` | Releases, merged PRs, new issues, and commits from a configurable look-back window |
| `github_notifications` | Authenticated attention queue for mentions, review requests, assignments, and authored threads |
| `github_repo_health` | Transparent repository health score with evidence, risks, and concrete next actions |
| `github_help` | Catalog of all 200 other tools — call it when unsure which tool to use |

Beyond GitHub, the catalog also covers **GitLab, Gitee, npm, PyPI, crates.io, Docker Hub, Hugging Face, Hacker News, Stack Overflow, Reddit**, and the **dsh plugin ecosystem itself** (registry stats) — one install, one consistent tool style, one cache.

Example prompts:

- "Give me a full report on `deepseek-ai/deepseek-harness`."
- "What open issues does `ollama/ollama` have right now?"
- "Who are the top contributors of `openai/openai-python`?"
- "Find the top 5 TypeScript agent frameworks and compare their stars."
- "What needs my attention on GitHub right now?"
- "Audit the repository health of `owner/repo` and tell me exactly what to fix."

## Install

```sh
dsh plugin --profile web add dsh-github-intelligence
# or, using the upstream CLI directly:
pnpm dlx @deepseek-ai/dsh plugin --profile web add dsh-github-intelligence

# standalone CLI (same catalog, for humans):
npm install -g dsh-github-intelligence
```

Then restart `dsh web` and ask your agent to use the tools above.

## Configuration

All values are optional and set in `cordis.yml`:

| Key | Type | Default | Description |
|---|---|---|---|
| `githubToken` | string | *(none)* | GitHub token to raise rate limits and enable `github_notifications` when it has notification read access. Never commit it. |
| `timeoutMs` | number | `10000` | Request timeout in milliseconds. |
| `defaultLimit` | number | `5` | Default result count when the model omits `limit`. |
| `bodyPreviewChars` | number | `500` | Maximum characters kept from a release body preview. |
| `cacheTtlMs` | number | `60000` | In-memory response cache TTL, so composed calls stay cheap. |
| `userAgent` | string | `dsh-github-intelligence/2.10.0` | User-Agent header sent to the GitHub API. |

## Why "most complete"

- **Breadth**: 201 tools across GitHub, 16 external developer ecosystems, and the dsh registry — not just one endpoint.
- **Depth**: `github_repo_report` composes repo facts; `github_weekly_digest` explains change; `github_notifications` creates a personal attention queue; `github_repo_health` turns evidence into risks and next actions.
- **Rate-limit friendly**: every endpoint is wrapped in a short TTL cache; the deep report reuses cached sub-calls (4 HTTP requests, not 4+ per repetition).
- **Correctness**: issues are filtered to exclude pull requests; every request honors `exec.signal`; anonymous rate limits and 429s produce actionable errors.
- **Verified**: 52 tests, real-registry visibility for all 201 tools, real-network smoke for every v2.3.0..v2.8.0 tool (37 tools), and CI that installs the bundle into `dsh web` and boots it (see [VERIFICATION.md](./VERIFICATION.md)).

> ⭐ If this helps your agent, a star helps the ecosystem find it. Feedback and issues are equally welcome.

## What's new in v2.10.0

- `github_notifications`: a read-only maintainer inbox that groups authenticated GitHub notifications into mentions, review requests, assignments, authored-thread updates, and other work.
- `github_repo_health`: a transparent 100-point maintenance heuristic with five scored dimensions, supporting evidence, risk flags, concrete recommendations, and an explicit non-security-audit caveat.
- 201 registered tools, 52 passing tests, and real-agent registry visibility checks for both new flagship tools.

## What's new in v2.3.0

- Plain list tools: `github_repo_releases`, `github_repo_issues` (pull requests filtered out), `github_repo_pulls`.
- People & social: `github_user_repositories`, `github_user_social_accounts`, `github_repo_contributors`, `github_repo_subscribers`, `github_repo_collaborators` (with effective permission, requires push access).
- Git, security & search: `github_repo_git_refs` (matching refs), `github_repo_punch_card`, `github_repo_security_advisories`, `github_search_repositories`.

## What's new in v2.4.0

- GitLab project depth: `gitlab_project_issues`, `gitlab_project_merge_requests`, `gitlab_project_commits`, `gitlab_project_branches`.
- Gitee depth: `gitee_repo_releases`, `gitee_repo_issues`, `gitee_repo_commits`.
- Stack Overflow: `so_question_answers`, `so_top_tags` — and the existing SO tools now send the required `site` param (real-API fix).
- Reddit: `reddit_subreddit_rising`, `reddit_subreddit_controversial` (Reddit may block cloud IPs; works from residential networks).
- New ecosystem dev.to: `devto_articles`, `devto_article`, `devto_user`.
- npm: `npm_package_dependencies` (direct deps of the latest version).
- Correctness fix: `limit` is now enforced locally — GitHub/GitLab/StackExchange ignore the query param and previously returned their full default page.

## What's new in v2.5.0

- Two new ecosystems: RubyGems (`rubygems_search`, `rubygems_gem`) and NuGet (`nuget_search`).
- Bitbucket was probed and deliberately NOT shipped: the public Cloud API now returns 404/410 for anonymous access — an "it's documented as public" trap caught by real-API verification.

## What's new in v2.6.0

- New ecosystem: the official Go module proxy (`go_module_latest`).
- More depth: `crates_crate_versions` (per-version downloads + yank status), `gitee_repo_contributors`, `gitlab_project_tags`, `so_related_tags`.
- Also probed and rejected: Maven Central (`search.maven.org` timed out repeatedly) and Hugging Face `/api/tags` (now 401) — not shipped because they would fail in real use.

## What's new in v2.7.0

- New flagship composite tool: `github_weekly_digest` — one call answers "what happened this week in owner/repo" (releases + merged PRs + new issues + commits, filtered to a configurable look-back window).

## What's new in v2.8.0

- npm downloads depth: `npm_downloads_last_day` and `npm_downloads_range` (per-day downloads between two dates).
- Also probed and rejected this round: Stack Exchange `/search/answers` (HTTP 400), crates.io dependencies endpoint (unreachable from this network), dev.to podcast episodes (unreachable) — not shipped.

## Development

```sh
pnpm install
pnpm run build
pnpm test
pnpm pack
```

## Demo (real output, 2026-08-15)

`github_repo_report` on `deepseek-ai/deepseek-harness`:

```text
# deepseek-ai/deepseek-harness
deepseek-ai/deepseek-harness — DeepSeek Harness: Everything is a Plugin.
Stars: 98472 · Forks: 9214 · Open issues: 0 · Default branch: master
Language: TypeScript · License: MIT · Pushed: 2026-08-13
https://github.com/deepseek-ai/deepseek-harness

Latest release: none
Open issues: 0

Recent commits:
- 47f9438 Merge pull request #2519 from deepseek-harness/feat/npm-public (imccyu)
- abe560f release(dsh): 0.1.0-rc.5 (imccyu)
- 8c1e8d9 build(release): publish the dsh family publicly (imccyu)
- f26a6f6 Merge pull request #2520 from deepseek-harness/docs/paper (Tianyi Cui)
- 124aa5f Merge pull request #2521 from deepseek-harness/release/dsh-0.1.0-rc.3 (imccyu)

Top contributors: 1. tianyicui (5235) · 2. LegGasai (1361) · 3. imccyu (1168) · 4. Chinesezjc (587) · 5. turtle1999 (585)
```

One question answers: what is this repo, what did it ship, who maintains it, and is it alive.

## License

MIT © 2026 zoahdev

---

## 中文

[![Awesome DSH Plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)
[![CI](https://img.shields.io/github/actions/workflow/status/zoahdev/dsh-github-intelligence/ci.yml?branch=main)](https://github.com/zoahdev/dsh-github-intelligence/actions)
[![Release](https://img.shields.io/github/v/release/zoahdev/dsh-github-intelligence)](https://github.com/zoahdev/dsh-github-intelligence/releases)

**dsh-github-intelligence —— 面向 DeepSeek Harness 的开发者情报系统：201 个只读工具，覆盖 GitHub、16 大外部生态与 dsh 注册表**。新增维护者通知待办和可解释的仓库健康审计；公共工具无需 API Key，全部请求支持取消、TTL 缓存与 UI 卡片。

> 话题：[`dsh-plugin`](https://github.com/topics/dsh-plugin) · 已在 `dsh` 0.1.0-rc.6 / Node 24 / pnpm 11 实测

## 工具

| 工具 | 功能 |
|---|---|
| `github_repo` | 仓库全景：星标、fork、issues、语言、许可证、话题、默认分支、归档状态、活跃时间 |
| `github_releases` | 最近 Release（tag、日期、预发布、链接、正文预览） |
| `github_issues` | 按状态查 Issue（open/closed/all），自动排除 PR |
| `github_pulls` | 按状态查 PR，含合并状态 |
| `github_contributors` | 按提交数排名的贡献者 |
| `github_search` | 按星标/更新时间搜索仓库 |
| `github_repo_report` | 深度报告：概览 + 最新 Release + open issues + 最近提交 + 头部贡献者 |
| `github_compare` | 两个仓库并排对比（含数值差量） |
| `github_trending` | 近期新建仓库按星标排序（可按语言过滤） |
| `github_user_repos` | 某用户星标最高的仓库 |
| `github_weekly_digest` | 可配置时间窗口内的 Release、已合并 PR、新 Issue 与提交 |
| `github_notifications` | 需要 Token 的维护者待办：@提及、审查请求、指派与本人主题更新 |
| `github_repo_health` | 带证据、风险项和具体改进建议的透明仓库健康评分 |
| `github_help` | 其余 200 个工具的自发现目录，不确定时先问它 |

GitHub 之外，目录还覆盖 **GitLab、Gitee、npm、PyPI、crates.io、Docker Hub、Hugging Face、Hacker News、Stack Overflow、Reddit** 以及 **dsh 插件生态自身**（注册表统计）——一次安装，统一风格，统一缓存。

示例提问：

- "给我一份 deepseek-ai/deepseek-harness 的完整报告"
- "ollama/ollama 现在有哪些 open issue？"
- "openai/openai-python 的头部贡献者是谁？"
- "找 5 个 TypeScript agent 框架并按星标对比"
- "我现在 GitHub 上有什么必须处理？"
- "审计 owner/repo 的仓库健康度，并告诉我具体改什么"

## 安装

```sh
dsh plugin --profile web add dsh-github-intelligence
# 或直接使用上游 CLI：
pnpm dlx @deepseek-ai/dsh plugin --profile web add dsh-github-intelligence
```

## 为什么说"最完整"

- **覆盖面**：201 个工具，覆盖 GitHub、16 大外部生态与 dsh 注册表，不是单点工具；
- **深度**：`github_repo_report` 汇总事实，`github_notifications` 形成个人待办，`github_repo_health` 给出有证据的风险与行动建议；
- **周报**：`github_weekly_digest` 一次回答"这个仓库这周发生了什么"；
- **省配额**：所有接口带短 TTL 缓存，深度报告复用缓存子调用，一次只发 4 个请求；
- **正确性**：Issue 自动排除 PR、全部请求支持取消、匿名限流/429 有明确提示；
- **验证**：52 个测试 + 201 个工具真实 Agent 注册可见性验证 + v2.3.0..v2.8.0 全部 37 个新工具真实网络冒烟 + CI 真实安装进 `dsh web` 并启动（见 [VERIFICATION.md](./VERIFICATION.md)）。

> ⭐ 如果它帮到了你的 agent，一个 star 就能让整个生态更容易发现它。反馈和 issue 同样欢迎。

## v2.10.0 新增

- `github_notifications`：只读维护者收件箱，把已认证的 GitHub 通知归类为 @提及、审查请求、指派、本人主题更新和其它待办；
- `github_repo_health`：透明的 100 分维护健康启发式，包含五项分数、原始证据、风险标记、具体建议，并明确说明它不是安全审计；
- 201 个注册工具、52 个通过测试，并在真实 Agent 工具注册表中验证两个新旗舰工具可见。

## v2.3.0 新增

- 平铺列表工具：`github_repo_releases`、`github_repo_issues`（自动排除 PR）、`github_repo_pulls`；
- 人与社交：`github_user_repositories`、`github_user_social_accounts`、`github_repo_contributors`、`github_repo_subscribers`、`github_repo_collaborators`（含实际权限，需 push 权限 token）；
- Git、安全与搜索：`github_repo_git_refs`（ref 前缀匹配）、`github_repo_punch_card`、`github_repo_security_advisories`、`github_search_repositories`。

## v2.4.0 新增

- GitLab 深度：`gitlab_project_issues`、`gitlab_project_merge_requests`、`gitlab_project_commits`、`gitlab_project_branches`；
- Gitee 深度：`gitee_repo_releases`、`gitee_repo_issues`、`gitee_repo_commits`；
- Stack Overflow：`so_question_answers`、`so_top_tags`；并修复既有 SO 工具缺 `site` 参数的真实 API 问题；
- Reddit：`reddit_subreddit_rising`、`reddit_subreddit_controversial`（Reddit 可能屏蔽云 IP，家庭网络可用）；
- 新生态 dev.to：`devto_articles`、`devto_article`、`devto_user`；
- npm：`npm_package_dependencies`（最新版直接依赖）；
- 正确性修复：`limit` 现在本地强制生效——GitHub/GitLab/StackExchange 会忽略该查询参数，之前会返回整页默认数量。

## v2.5.0 新增

- 两个新生态：RubyGems（`rubygems_search`、`rubygems_gem`）与 NuGet（`nuget_search`）；
- Bitbucket 已探测但**故意不收录**：公共 Cloud API 匿名访问现在返回 404/410——这是"文档写着公开、实际已关"的坑，真实 API 验证拦住了它。

## v2.6.0 新增

- 新生态：官方 Go module proxy（`go_module_latest`）；
- 深度补强：`crates_crate_versions`（各版本下载量 + yank 状态）、`gitee_repo_contributors`、`gitlab_project_tags`、`so_related_tags`；
- 同样探测后拒绝：Maven Central（search.maven.org 反复超时）与 Hugging Face `/api/tags`（现在 401）——真实使用会挂，所以不收录。

## v2.7.0 新增

- 新旗舰复合工具：`github_weekly_digest`——一次调用回答"owner/repo 这周发生了什么"（release + 合并 PR + 新 issue + 提交，可按天配置窗口）。

## v2.8.0 新增

- npm 下载深度：`npm_downloads_last_day` 与 `npm_downloads_range`（两个日期之间的每日下载量）；
- 本轮探测后拒绝：Stack Exchange `/search/answers`（HTTP 400）、crates.io 依赖端点（本网络不可达）、dev.to podcast（不可达）——不收录。

## 开发

```sh
pnpm install
pnpm run build
pnpm test
pnpm pack
```

## 演示（真实输出，2026-08-15）

`github_repo_report` 对 `deepseek-ai/deepseek-harness` 的实际结果：

```text
# deepseek-ai/deepseek-harness
deepseek-ai/deepseek-harness — DeepSeek Harness: Everything is a Plugin.
Stars: 98472 · Forks: 9214 · Open issues: 0 · Default branch: master
Language: TypeScript · License: MIT · Pushed: 2026-08-13
https://github.com/deepseek-ai/deepseek-harness

Latest release: none
Open issues: 0

Recent commits:
- 47f9438 Merge pull request #2519 from deepseek-harness/feat/npm-public (imccyu)
- abe560f release(dsh): 0.1.0-rc.5 (imccyu)
- 8c1e8d9 build(release): publish the dsh family publicly (imccyu)
- f26a6f6 Merge pull request #2520 from deepseek-harness/docs/paper (Tianyi Cui)
- 124aa5f Merge pull request #2521 from deepseek-harness/release/dsh-0.1.0-rc.3 (imccyu)

Top contributors: 1. tianyicui (5235) · 2. LegGasai (1361) · 3. imccyu (1168) · 4. Chinesezjc (587) · 5. turtle1999 (585)
```

一次提问回答三件事：这仓库是什么、最近发了什么、谁在维护、还活着吗。

## 许可证

MIT © 2026 zoahdev


**Engineering blog:** https://zoahdev.github.io/blog/ — deep-dives on the bugs behind this catalog (root causes, reproductions, mechanism-level fixes).
