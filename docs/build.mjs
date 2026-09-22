// Builds the public site from the repository itself: the marketplace manifest, each mod's plugin.json
// and each mod's README. Nothing here is written by hand twice, so a new mod reaches the site with its
// own commit and no other step.
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Marked } from 'marked'

const DOCS = dirname(fileURLToPath(import.meta.url))
const ROOT = join(DOCS, '..')
const OUT = join(ROOT, 'site')

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))
const readText = async path => readFile(path, 'utf8')

const copy = await readJson(join(DOCS, 'copy.json'))
const market = await readJson(join(ROOT, '.claude-plugin', 'marketplace.json'))
const REPO = copy.site.repo

const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/** The reach level a mod's README states, or L1 when it states none. */
function reachOf(readme) {
  return /^Reach (L[0-3])/m.exec(readme)?.[1] ?? 'L1'
}

/** The card's own sentence: the manifest description without the early-access note every mod repeats. */
function summaryOf(description) {
  return description.replace(/\s*Needs function hooks \(early access\)\.\s*$/, '').trim()
}

/** A README link, rewritten for the site: a sibling mod becomes its page, a file becomes its source on GitHub. */
function fixLink(href, mod) {
  if (/^(https?:|mailto:|#)/.test(href)) return href
  const sibling = /^\.\.\/([A-Za-z0-9._-]+)\/?$/.exec(href)
  if (sibling !== null) return `${sibling[1]}.html`
  if (href.startsWith('../')) return `${REPO}/blob/main/plugins/${href.slice(3)}`
  return `${REPO}/blob/main/plugins/${mod}/${href.replace(/^\.\//, '')}`
}

/** One markdown renderer per mod, because the link rewrite needs the mod it renders. */
function markdown(text, mod) {
  const marked = new Marked({ gfm: true })
  marked.use({ renderer: { link({ href, title, tokens }) {
    const label = this.parser.parseInline(tokens)
    const attr = title === null || title === undefined ? '' : ` title="${escape(title)}"`
    return `<a href="${escape(fixLink(href, mod))}"${attr}>${label}</a>`
  } } })
  return marked.parse(text)
}

async function mods() {
  const found = []
  for (const entry of market.plugins) {
    const dir = join(ROOT, 'plugins', entry.name)
    const manifest = await readJson(join(dir, '.claude-plugin', 'plugin.json'))
    const readme = await readText(join(dir, 'README.md'))
    found.push({
      name: entry.name,
      version: manifest.version,
      category: entry.category ?? 'other',
      tags: entry.tags?.filter(t => !['mods', 'function-hooks', 'hooks-module'].includes(t)) ?? [],
      summary: summaryOf(manifest.description ?? entry.description ?? ''),
      reach: reachOf(readme),
      readme,
    })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/** The same text in both languages, one of which the page's language switch hides. */
const both = (key, wrap = t => t) =>
  ['tr', 'en'].map(lang => `<div data-lang-block="${lang}">${wrap(copy[lang][key], lang)}</div>`).join('')

function head(title, depth) {
  const base = depth === 0 ? '' : '../'
  return `<!doctype html>
<html lang="tr" data-lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(copy.en.tagline)}">
<link rel="icon" href="${base}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${base}style.css">
<script>
  // The language choice is kept in a cookie, never in localStorage.
  var m = document.cookie.match(/(?:^|; )lang=(tr|en)/)
  if (m) document.documentElement.setAttribute('data-lang', m[1])
</script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="${base}index.html">${escape(copy.site.title)}</a>
  <nav>
    <a class="hide-sm" href="${REPO}">GitHub</a>
    <a class="hide-sm" href="${copy.site.author.url}">${escape(copy.site.author.name)}</a>
    <div class="langs"><button data-set="tr">TR</button><button data-set="en">EN</button></div>
  </nav>
</div></header>`
}

function foot(depth) {
  const base = depth === 0 ? '' : '../'
  return `<footer class="bottom"><div class="wrap">
  ${both('generated', t => `<p>${t}</p>`)}
  <p><a href="${REPO}">${escape(REPO)}</a> · MIT</p>
</div></footer>
<script src="${base}site.js"></script>
</body></html>
`
}

function card(mod) {
  const tags = mod.tags.slice(0, 4).map(t => `<span>${escape(t)}</span>`).join('')
  return `<article class="card" data-reach="${mod.reach}" data-search="${escape([mod.name, mod.summary, ...mod.tags].join(' ').toLowerCase())}">
  <h3><a href="mods/${mod.name}.html">${escape(mod.name)}</a></h3>
  <p>${escape(mod.summary)}</p>
  <div class="meta">
    <span class="reach ${mod.reach}">${mod.reach}</span>
    <span class="version">v${escape(mod.version)}</span>
    <div class="tags">${tags}</div>
  </div>
</article>`
}

function reachList(lang) {
  const rows = Object.entries(copy[lang].reach).map(([level, text]) =>
    `<dt><span class="reach ${level}">${level}</span></dt><dd>${escape(text)}</dd>`).join('')
  return `<dl class="reach-list">${rows}</dl>`
}

function installBlock(lang) {
  const c = copy[lang]
  return `<p class="sub">${escape(c.installLead)}</p>
<pre><code>claude plugin marketplace add KilimcininKorOglu/claude-code-mods
claude plugin install &lt;mod&gt;@${escape(copy.site.marketplace)}</code></pre>
<p>${c.flagNote}</p>
<pre><code>{ "env": { "CLAUDE_CODE_ENABLE_FUNCTION_HOOKS": "1" } }</code></pre>`
}

function hero(list) {
  const levels = ['L0', 'L1', 'L2', 'L3'].map(l => list.filter(m => m.reach === l).length)
  const counts = `<div class="counts">
    <div><b>${list.length}</b>mod</div>
    <div><b>${levels[0] + levels[1]}</b>L0 + L1</div>
    <div><b>${levels[2]}</b>L2</div>
    <div><b>${levels[3]}</b>L3</div>
  </div>`
  return `<div class="hero"><div class="wrap">
  <h1>${escape(copy.site.title)}</h1>
  ${both('tagline', t => `<p class="tagline">${escape(t)}</p>`)}
  ${both('lead', t => `<p class="lead">${escape(t)}</p>`)}
  ${counts}
</div></div>`
}

function indexPage(list) {
  const filters = ['all', 'L0', 'L1', 'L2', 'L3'].map(level =>
    `<button data-reach="${level}" aria-pressed="${level === 'all'}">${level === 'all' ? `<span data-lang-block="tr">${escape(copy.tr.allReach)}</span><span data-lang-block="en">${escape(copy.en.allReach)}</span>` : level}</button>`).join('')
  return `${head(copy.site.title, 0)}
${hero(list)}
<main>
<section id="install"><div class="wrap">
  ${both('installTitle', t => `<h2>${escape(t)}</h2>`)}
  ${['tr', 'en'].map(lang => `<div data-lang-block="${lang}">${installBlock(lang)}</div>`).join('')}
</div></section>
<section id="mods"><div class="wrap">
  ${both('modsTitle', t => `<h2>${escape(t)}</h2>`)}
  ${both('modsLead', t => `<p class="sub">${escape(t)}</p>`)}
  <div class="controls">
    <input type="search" id="q" placeholder="${escape(copy.tr.searchPlaceholder)}" data-ph-tr="${escape(copy.tr.searchPlaceholder)}" data-ph-en="${escape(copy.en.searchPlaceholder)}" autocomplete="off">
    <div class="filters">${filters}</div>
  </div>
  <div class="grid" id="grid">${list.map(card).join('\n')}</div>
  <p class="empty" id="empty" hidden>0</p>
</div></section>
<section id="reach"><div class="wrap">
  ${both('reachTitle', t => `<h2>${escape(t)}</h2>`)}
  ${['tr', 'en'].map(lang => `<div data-lang-block="${lang}">${reachList(lang)}</div>`).join('')}
  ${both('docsNote', t => `<p class="sub" style="margin-top:18px">${escape(t)}</p>`)}
</div></section>
</main>
${foot(0)}`
}

/** Every mod by name, so each page carries the whole list and the one it draws is marked. */
function sideNav(list, current) {
  const rows = list.map(m => {
    const here = m.name === current ? ' aria-current="page"' : ''
    return `<li><a href="${m.name}.html"${here}>${escape(m.name)}</a></li>`
  }).join('')
  return `<aside class="side">
  <h4><span data-lang-block="tr">${escape(copy.tr.modsTitle)}</span><span data-lang-block="en">${escape(copy.en.modsTitle)}</span> (${list.length})</h4>
  <ol>${rows}</ol>
</aside>`
}

function modPage(mod, list) {
  const body = markdown(mod.readme, mod.name)
  return `${head(`${mod.name} · ${copy.site.title}`, 1)}
<main class="wrap"><div class="page">
${sideNav(list, mod.name)}
<article class="doc">
  <div class="docbar">
    <a href="../index.html"><span data-lang-block="tr">← ${escape(copy.tr.backToIndex)}</span><span data-lang-block="en">← ${escape(copy.en.backToIndex)}</span></a>
    <span class="reach ${mod.reach}">${mod.reach}</span>
    <span class="version">v${escape(mod.version)}</span>
    <a href="${REPO}/tree/main/plugins/${mod.name}">source</a>
  </div>
  ${body}
</article></div></main>
${foot(1)}`
}

const SCRIPT = `// The mod filter and the language switch. No framework, no storage but one cookie.
const grid = document.getElementById('grid')
const cards = grid === null ? [] : [...grid.querySelectorAll('.card')]
const box = document.getElementById('q')
const empty = document.getElementById('empty')
let reach = 'all'

function apply() {
  const term = (box?.value ?? '').trim().toLowerCase()
  let shown = 0
  for (const c of cards) {
    const ok = (reach === 'all' || c.dataset.reach === reach) && (term === '' || c.dataset.search.includes(term))
    c.hidden = !ok
    if (ok) shown++
  }
  if (empty !== null) {
    empty.hidden = shown > 0
    empty.textContent = document.documentElement.dataset.lang === 'tr' ? 'Eşleşen mod yok.' : 'No mod matches.'
  }
}

box?.addEventListener('input', apply)
for (const b of document.querySelectorAll('.filters button')) {
  b.addEventListener('click', () => {
    reach = b.dataset.reach
    for (const o of document.querySelectorAll('.filters button')) o.setAttribute('aria-pressed', String(o === b))
    apply()
  })
}

function setLang(lang) {
  document.documentElement.setAttribute('data-lang', lang)
  document.documentElement.setAttribute('lang', lang)
  document.cookie = 'lang=' + lang + ';path=/;max-age=31536000;samesite=lax'
  if (box !== null) box.placeholder = box.dataset['ph' + (lang === 'tr' ? 'Tr' : 'En')]
  apply()
}

for (const b of document.querySelectorAll('.langs button')) b.addEventListener('click', () => setLang(b.dataset.set))
setLang(document.documentElement.dataset.lang ?? 'tr')
`

async function build() {
  const list = await mods()
  // The output is generated, so it is thrown away and written again rather than merged.
  await rm(OUT, { recursive: true, force: true })
  await mkdir(join(OUT, 'mods'), { recursive: true })
  await writeFile(join(OUT, 'index.html'), indexPage(list))
  for (const mod of list) await writeFile(join(OUT, 'mods', `${mod.name}.html`), modPage(mod, list))
  await copyFile(join(DOCS, 'style.css'), join(OUT, 'style.css'))
  await copyFile(join(DOCS, 'favicon.svg'), join(OUT, 'favicon.svg'))
  await writeFile(join(OUT, 'site.js'), SCRIPT)
  await writeFile(join(OUT, 'CNAME'), `${copy.site.domain}\n`)
  await writeFile(join(OUT, '.nojekyll'), '')
  await writeFile(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: https://${copy.site.domain}/sitemap.xml\n`)
  const urls = ['index.html', ...list.map(m => `mods/${m.name}.html`)]
    .map(p => `  <url><loc>https://${copy.site.domain}/${p}</loc></url>`).join('\n')
  await writeFile(join(OUT, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`)
  console.log(`site: ${list.length} mods, ${urls.split('\n').length} pages`)
}

await build()
