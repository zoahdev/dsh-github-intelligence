# dsh-github-intelligence

[English](#english) · [中文](#中文)

**The most complete GitHub integration for DeepSeek Harness.** Seven model-facing tools over the public GitHub REST API — no API key required — plus a one-shot deep repo report, rate-limit-friendly TTL caching, cancellation, and UI cards.

> Topic: [`dsh-plugin`](https://github.com/topics/dsh-plugin) · Tested with `dsh` 0.1.0-rc.6 · Node 24 / pnpm 11

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

Example prompts:

- "Give me a full report on `deepseek-ai/deepseek-harness`."
- "What open issues does `ollama/ollama` have right now?"
- "Who are the top contributors of `openai/openai-python`?"
- "Find the top 5 TypeScript agent frameworks and compare their stars."

## Install

```sh
dsh plugin --profile web add github:zoahdev/dsh-github-intelligence
# or from tarball:
dsh plugin --profile web add ./dsh-github-intelligence-1.0.0.tgz
```

Then restart `dsh web` and ask your agent to use the tools above.

## Configuration

All values are optional and set in `cordis.yml`:

| Key | Type | Default | Description |
|---|---|---|---|
| `githubToken` | string | *(none)* | GitHub token to raise the anonymous 60 requests/hour limit. Never commit it. |
| `timeoutMs` | number | `10000` | Request timeout in milliseconds. |
| `defaultLimit` | number | `5` | Default result count when the model omits `limit`. |
| `bodyPreviewChars` | number | `500` | Maximum characters kept from a release body preview. |
| `cacheTtlMs` | number | `60000` | In-memory response cache TTL, so composed calls stay cheap. |
| `userAgent` | string | `dsh-github-intelligence/1.0.0` | User-Agent header sent to the GitHub API. |

## Why "most complete"

- **Breadth**: covers the five surfaces developers actually ask about (repo, releases, issues, PRs, contributors) plus search — not just one endpoint.
- **Depth**: `github_repo_report` composes all of them into one canonical answer with a single agent turn.
- **Rate-limit friendly**: every endpoint is wrapped in a short TTL cache; the deep report reuses cached sub-calls (4 HTTP requests, not 4+ per repetition).
- **Correctness**: issues are filtered to exclude pull requests; every request honors `exec.signal`; anonymous rate limits and 429s produce actionable errors.
- **Verified**: 16 tests, CI that installs the bundle into `dsh web` and boots it (see [VERIFICATION.md](./VERIFICATION.md)).

## Development

```sh
pnpm install
pnpm run build
pnpm test
pnpm pack
```

## License

MIT © 2026 zoahdev

---

## 中文

**dsh-github-intelligence —— DeepSeek Harness 上最完整的 GitHub 整合。** 7 个模型可直接调用的工具，覆盖仓库、Release、Issue、PR、贡献者、搜索，外加一键"深度报告"；无需 API Key，内置 60 秒缓存帮你在匿名限流下省着用。

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

示例提问：

- "给我一份 deepseek-ai/deepseek-harness 的完整报告"
- "ollama/ollama 现在有哪些 open issue？"
- "openai/openai-python 的头部贡献者是谁？"
- "找 5 个 TypeScript agent 框架并按星标对比"

## 安装

```sh
dsh plugin --profile web add github:zoahdev/dsh-github-intelligence
dsh plugin --profile web add ./dsh-github-intelligence-1.0.0.tgz
```

## 为什么说"最完整"

- **覆盖面**：开发者会问的五类数据全都有（仓库/Release/Issue/PR/贡献者）+ 搜索，不是单点工具；
- **深度**：`github_repo_report` 一次回答"这个仓库到底怎么样"；
- **省配额**：所有接口带短 TTL 缓存，深度报告复用缓存子调用，一次只发 4 个请求；
- **正确性**：Issue 自动排除 PR、全部请求支持取消、匿名限流/429 有明确提示；
- **验证**：16 个测试 + CI 真实安装进 `dsh web` 并启动（见 [VERIFICATION.md](./VERIFICATION.md)）。

## 开发

```sh
pnpm install
pnpm run build
pnpm test
pnpm pack
```

## 许可证

MIT © 2026 zoahdev
