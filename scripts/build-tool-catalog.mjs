import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { catalog } from '../lib/catalog.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const FLAGSHIP = [
  ['github_repo', 'Full repo overview: stars, forks, issues, language, license, topics, default branch, archived, activity dates.'],
  ['github_releases', 'Recent releases with tag, date, pre-release flag, URL, and body preview.'],
  ['github_search', 'Repository search sorted by stars or last update.'],
  ['github_issues', 'Recent issues by state (open/closed/all), pull requests excluded.'],
  ['github_pulls', 'Recent pull requests by state, including merge status.'],
  ['github_contributors', 'Top contributors by commit count.'],
  ['github_repo_report', 'One-shot deep report: overview + latest release + open issues + recent commits + top contributors.'],
  ['github_compare', 'Side-by-side comparison of two repositories with numeric deltas.'],
  ['github_trending', 'Recently created repositories sorted by stars (optional language filter).'],
  ['github_user_repos', "A user's top repositories by stars."],
  ['github_weekly_digest', 'One-week digest: releases, merged PRs, new issues, and commits from the last N days.'],
  ['arxiv_search', 'Search the ArXiv preprint corpus (title, authors, abstract, date, link).'],
  ['github_help', 'Self-discoverable catalog of all available tools.'],
]

const ECOSYSTEM_LABEL = {
  github: 'GitHub', gitlab: 'GitLab', gitee: 'Gitee', npm: 'npm', pypi: 'PyPI',
  crates: 'crates.io', docker: 'Docker Hub', hf: 'Hugging Face', hn: 'Hacker News',
  so: 'Stack Overflow', reddit: 'Reddit', devto: 'dev.to', rubygems: 'RubyGems',
  nuget: 'NuGet', go: 'Go proxy', dsh: 'DSH registry',
}

const EXAMPLES = {
  GitHub: 'github_repo_report deepseek-ai/deepseek-harness',
  npm: 'npm_downloads_range react',
  PyPI: 'pypi_project requests',
  ArXiv: 'arxiv_search retrieval augmented generation',
  'Hacker News': 'hn_top',
  'Stack Overflow': 'so_search typescript generics',
  'Docker Hub': 'docker_search postgres',
}

function ecosystemOf(name) {
  return ECOSYSTEM_LABEL[name.split('_')[0]] ?? 'Flagship'
}

function paramsOf(spec) {
  if (spec.params === undefined) return ''
  return Object.entries(spec.params).map(([k, v]) => {
    const required = v.required === true ? ' (required)' : ''
    const def = v.default !== undefined ? ' = ' + v.default : ''
    return k + required + def
  }).join(', ')
}

const tools = [
  ...FLAGSHIP.map(([name, description]) => ({ name, description, ecosystem: 'Flagship', kind: '', params: '', path: '' })),
  ...catalog.map((spec) => ({
    name: spec.name,
    description: spec.description,
    ecosystem: ecosystemOf(spec.name),
    kind: spec.kind,
    params: paramsOf(spec),
    example: spec.example ?? '',
    path: spec.baseUrl ? spec.baseUrl + spec.path : spec.path,
  })),
].sort((a, b) => a.ecosystem.localeCompare(b.ecosystem) || a.name.localeCompare(b.name))

const css = ':root{color-scheme:dark;--bg:#0d1117;--surface:#161b22;--ink:#e6edf3;--muted:#8b949e;--line:#30363d;--accent:#388bfd}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}.wrap{max-width:1040px;margin:0 auto;padding:40px 20px 80px}h1{font-size:30px;letter-spacing:-.02em;margin:0 0 6px}.sub{color:var(--muted);margin:0 0 22px}.install{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:0 0 18px}.install code{background:var(--surface);border:1px solid var(--line);padding:9px 12px;border-radius:8px;font-family:ui-monospace,monospace;font-size:13px}.copy{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 14px;cursor:pointer;font-size:13px}.copy:active{opacity:.8}.chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}.chip{background:var(--surface);border:1px solid var(--line);border-radius:999px;padding:6px 12px;font-size:13px;color:var(--muted);cursor:pointer}.chip:hover{border-color:var(--accent);color:var(--ink)}.controls{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:18px}input[type=search],select{background:var(--surface);border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:10px 12px;font-size:14px;outline:none;min-width:220px}input[type=search]:focus,select:focus{border-color:var(--accent)}.count{color:var(--muted);margin:0 0 14px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:14px 15px}.card .name{font-family:ui-monospace,Consolas,monospace;font-size:14px;color:var(--accent);font-weight:600}.card .eco{float:right;font-size:11px;color:var(--muted);border:1px solid var(--line);border-radius:999px;padding:1px 8px}.card .desc{margin:8px 0 0}.card .meta{margin-top:8px;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.empty{color:var(--muted);padding:20px;text-align:center}'

const js = 'const tools=' + JSON.stringify(tools) + ';const ecoSel=document.getElementById("eco");const q=document.getElementById("q");const grid=document.getElementById("grid");const count=document.getElementById("count");const ecosystems=[...new Set(tools.map(t=>t.ecosystem))].sort();for(const e of ecosystems){const o=document.createElement("option");o.value=e;o.textContent=e;ecoSel.appendChild(o)}function esc(s){return String(s).replace(/[&<>"\']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;","\'":"&#39;"}[c]))}function render(){const term=q.value.trim().toLowerCase();const eco=ecoSel.value;const rows=tools.filter(t=>(eco===""||t.ecosystem===eco)&&(term===""||(t.name+" "+t.description+" "+t.params).toLowerCase().includes(term)));count.textContent=rows.length+" tool"+(rows.length===1?"":"s");grid.innerHTML=rows.length?rows.map(t=>{const meta=[t.kind,t.params,t.path].filter(Boolean).join(" · ");return \'<div class="card"><div><span class="name">\'+esc(t.name)+\'</span><span class="eco">\'+esc(t.ecosystem)+\'</span></div><p class="desc">\'+esc(t.description)+\'</p>\'+(meta?\'<div class="meta">\'+esc(meta)+\'</div>\':\'\')+\'</div>\'}).join(""):\'<div class="empty">No tools match.</div>\'}q.addEventListener("input",render);ecoSel.addEventListener("change",render);document.querySelectorAll(".copy").forEach(b=>b.addEventListener("click",()=>{navigator.clipboard.writeText(b.dataset.copy).then(()=>{const old=b.textContent;b.textContent="Copied";setTimeout(()=>b.textContent=old,1200)})}));document.querySelectorAll(".chip").forEach(c=>c.addEventListener("click",()=>{ecoSel.value=c.dataset.eco;render()}));render();'

const chipsHtml = Object.entries(EXAMPLES).map(([eco, prompt]) => '<button class="chip" data-eco="' + eco + '" title="' + prompt + '">' + eco + '</button>').join('')

const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>dsh-github-intelligence — tool catalog</title><style>' + css + '</style></head><body><div class="wrap"><h1>dsh-github-intelligence</h1><p class="sub">Every read-only tool the plugin registers, generated from the real catalog.</p><div class="install"><code>dsh plugin add dsh-github-intelligence</code><button class="copy" data-copy="dsh plugin add dsh-github-intelligence">Copy</button><code>npm install -g dsh-github-intelligence</code><button class="copy" data-copy="npm install -g dsh-github-intelligence">Copy</button></div><div class="chips">' + chipsHtml + '</div><div class="controls"><input id="q" type="search" placeholder="Search tools..."><select id="eco"><option value="">All ecosystems</option></select></div><p class="count" id="count"></p><div class="grid" id="grid"></div></div><script>' + js + '</script></body></html>'

const outDir = join(root, 'docs')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'index.html')
writeFileSync(outFile, html, 'utf8')
process.stdout.write('wrote ' + outFile + ' (' + tools.length + ' tools)\n')
