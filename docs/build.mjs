// Builds the public site from the repository itself: the marketplace manifest, each mod's plugin.json
// and each mod's two READMEs. Nothing here is written by hand twice, so a new mod reaches the site with
// its own commit and no other step.
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

/** The Turkish card sentence: the first paragraph of the mod's Turkish README, as plain text. */
function leadOf(readme) {
  if (readme === null) return null
  const paragraph = readme.replace(/^#[^\n]*\n/, '').split(/\n\s*\n/).map(p => p.trim()).find(p => p !== '' && !p.startsWith('#'))
  if (paragraph === undefined) return null
  return paragraph.replace(/\s+/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[`*]/g, '').trim()
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
    // The Turkish page comes from the mod's own README.tr.md; a mod without one shows the English body.
    const readmeTr = await readText(join(dir, 'README.tr.md')).catch(() => null)
    found.push({
      name: entry.name,
      version: manifest.version,
      tags: entry.tags?.filter(t => !['mods', 'function-hooks', 'hooks-module'].includes(t)) ?? [],
      summary: summaryOf(manifest.description ?? entry.description ?? ''),
      summaryTr: leadOf(readmeTr),
      reach: reachOf(readme),
      readme,
      readmeTr,
    })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/** The same text in both languages, one of which the page's language switch hides. */
const both = (key, wrap = t => t) =>
  ['tr', 'en'].map(lang => `<div data-lang-block="${lang}">${wrap(copy[lang][key], lang)}</div>`).join('')

const pair = (key, wrap = t => t) =>
  ['tr', 'en'].map(lang => `<span data-lang-block="${lang}">${wrap(copy[lang][key], lang)}</span>`).join('')

/**
 * The fixed left sidebar: the brand, the filter and every mod by name. The mods live here alone.
 * `root` is the path back to the site root from the page being written: '' on the index,
 * '../' on a mod page. Every href is built from it, so a mod page always sits under mods/.
 */
function sidebar(list, current, root) {
  const rows = list.map(m => {
    const here = m.name === current ? ' aria-current="page"' : ''
    const title = escape(m.summaryTr ?? m.summary)
    return `<li data-search="${escape([m.name, m.summary, m.summaryTr ?? '', ...m.tags].join(' ').toLowerCase())}" data-reach="${m.reach}"><a href="${root}mods/${m.name}.html" title="${title}"${here}><span class="dot ${m.reach}"></span>${escape(m.name)}</a></li>`
  }).join('')
  const filters = ['all', 'L0', 'L1', 'L2', 'L3'].map(level => {
    const label = level === 'all' ? pair('allReach', escape) : level
    return `<button data-reach="${level}" aria-pressed="${level === 'all'}">${label}</button>`
  }).join('')
  return `<aside class="side">
  <a class="brand" href="${root}index.html">${escape(copy.site.title)}<span>${escape(copy.site.marketplace)}</span></a>
  <input type="search" id="side-q" placeholder="${escape(copy.tr.searchPlaceholder)}" data-ph-tr="${escape(copy.tr.searchPlaceholder)}" data-ph-en="${escape(copy.en.searchPlaceholder)}" autocomplete="off">
  <div class="filters">${filters}</div>
  <h4>${pair('modsTitle')} <span id="side-count">(${list.length})</span></h4>
  <nav><ol id="side-list">${rows}</ol></nav>
  <div class="foot"><a href="${REPO}">GitHub</a><a href="${copy.site.author.url}">${escape(copy.site.author.name)}</a></div>
</aside>`
}

function page(title, list, current, root, body) {
  return `<!doctype html>
<html lang="tr" data-lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(copy.en.tagline)}">
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${root}style.css">
<script>
  // The language choice is kept in a cookie, never in localStorage.
  var m = document.cookie.match(/(?:^|; )lang=(tr|en)/)
  if (m) document.documentElement.setAttribute('data-lang', m[1])
</script>
</head>
<body>
<div class="shell">
${sidebar(list, current, root)}
<div class="main">
  <header class="top"><div class="inner">
    <a href="${root}index.html#install">${pair('installTitle')}</a>
    <a href="${root}index.html#reach">${pair('reachTitle')}</a>
    <div class="langs"><button data-set="tr">TR</button><button data-set="en">EN</button></div>
  </div></header>
${body}
  <footer class="bottom"><div class="wrap">
    ${both('generated', t => `<p>${escape(t)}</p>`)}
    <p><a href="${REPO}">${escape(REPO)}</a> · MIT</p>
  </div></footer>
</div>
</div>
<script src="${root}site.js"></script>
</body></html>
`
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
  const at = level => list.filter(m => m.reach === level).length
  return `<div class="wrap"><div class="hero">
  <h1>${escape(copy.site.title)}</h1>
  ${both('tagline', t => `<p class="tagline">${escape(t)}</p>`)}
  ${both('lead', t => `<p class="lead">${escape(t)}</p>`)}
  <div class="counts">
    <div><b>${list.length}</b>mod</div>
    <div><b>${at('L0') + at('L1')}</b>L0 + L1</div>
    <div><b>${at('L2')}</b>L2</div>
    <div><b>${at('L3')}</b>L3</div>
  </div>
</div></div>`
}

function indexPage(list) {
  const body = `<main>
${hero(list)}
<div class="wrap">
  <section id="install">
    ${both('installTitle', t => `<h2>${escape(t)}</h2>`)}
    ${['tr', 'en'].map(lang => `<div data-lang-block="${lang}">${installBlock(lang)}</div>`).join('')}
  </section>
  <section id="reach">
    ${both('reachTitle', t => `<h2>${escape(t)}</h2>`)}
    ${['tr', 'en'].map(lang => `<div data-lang-block="${lang}">${reachList(lang)}</div>`).join('')}
    ${both('docsNote', t => `<p class="sub" style="margin-top:18px">${escape(t)}</p>`)}
  </section>
</div>
</main>`
  return page(copy.site.title, list, null, '', body)
}

function modPage(mod, list) {
  const english = markdown(mod.readme, mod.name)
  const turkish = mod.readmeTr === null
    ? `<p class="sub">${escape(copy.tr.noTurkish)}</p>${english}`
    : markdown(mod.readmeTr, mod.name)
  const body = `<main class="wrap"><article class="doc">
  <div class="docbar">
    <span class="reach ${mod.reach}">${mod.reach}</span>
    <span class="version">v${escape(mod.version)}</span>
    <a href="${REPO}/tree/main/plugins/${mod.name}">source</a>
  </div>
  <div data-lang-block="tr">${turkish}</div>
  <div data-lang-block="en">${english}</div>
</article></main>`
  return page(`${mod.name} · ${copy.site.title}`, list, mod.name, '../', body)
}

const SCRIPT = `// The sidebar's filter and the language switch. No framework, no storage but one cookie.
const rows = [...document.querySelectorAll('#side-list li')]
const box = document.getElementById('side-q')
const count = document.getElementById('side-count')
let reach = 'all'

function apply() {
  const term = (box?.value ?? '').trim().toLowerCase()
  let shown = 0
  for (const r of rows) {
    const ok = (reach === 'all' || r.dataset.reach === reach) && (term === '' || r.dataset.search.includes(term))
    r.hidden = !ok
    if (ok) shown++
  }
  if (count !== null) count.textContent = '(' + shown + ')'
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

// The open mod is scrolled into view in a long sidebar.
document.querySelector('#side-list a[aria-current="page"]')?.scrollIntoView({ block: 'center' })
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
  const translated = list.filter(m => m.readmeTr !== null).length
  console.log(`site: ${list.length} mods, ${translated} with a Turkish README`)
}

await build()
