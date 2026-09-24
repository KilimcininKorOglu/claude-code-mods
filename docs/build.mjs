// Builds the public site from the repository itself: the marketplace manifest, each mod's plugin.json
// and each mod's two READMEs. Nothing here is written by hand twice, so a new mod reaches the site with
// its own commit and no other step. Each language has pages of its own, Turkish at the root and English
// under en/, so a search engine indexes each language under its own URL.
import { execFileSync } from 'node:child_process'
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

/** Each language and the directory its pages sit in; the first one is the default (x-default). */
const LANGS = [{ lang: 'tr', dir: '' }, { lang: 'en', dir: 'en/' }]
const dirOf = lang => LANGS.find(l => l.lang === lang).dir

/** The path back to the site root from a page at `path` (`mods/x.html` -> `../`). */
const upTo = path => '../'.repeat(path.split('/').length - 1)

const urlOf = path => `https://${copy.site.domain}/${path}`

/** The page's URL in every language, and x-default for the rest: the head's links and the sitemap's. */
function alternates(path) {
  return [...LANGS.map(l => ({ hreflang: l.lang, href: urlOf(l.dir + path) })), { hreflang: 'x-default', href: urlOf(LANGS[0].dir + path) }]
}

/**
 * The time of the last commit that touched any of `paths`, for the sitemap's lastmod. A shallow clone holds
 * one commit that reads as the last change of every file, so it is refused rather than written as a date.
 */
function lastCommit(paths) {
  const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()
  if (git(['rev-parse', '--is-shallow-repository']) === 'true') throw new Error('a shallow clone gives every page one date; check out with fetch-depth: 0')
  const at = git(['log', '-1', '--format=%cI', '--', ...paths])
  if (at === '') throw new Error(`no commit touches ${paths.join(', ')}`)
  return at
}

/** What every page is built from besides its own files. */
const TEMPLATE = ['docs/build.mjs', 'docs/copy.json']

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
      lastmod: lastCommit([...TEMPLATE, `plugins/${entry.name}/README.md`, `plugins/${entry.name}/README.tr.md`, `plugins/${entry.name}/.claude-plugin/plugin.json`]),
    })
  }
  return found.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The fixed left sidebar: the brand, the filter and every mod by name, in one language. The mods live here
 * alone. `root` is the path back to the site root; `here` adds the language's own directory, so every link
 * stays in the page's language.
 */
function sidebar(list, current, lang, root) {
  const here = root + dirOf(lang)
  const c = copy[lang]
  const rows = list.map(m => {
    const at = m.name === current ? ' aria-current="page"' : ''
    const title = escape(lang === 'tr' ? m.summaryTr ?? m.summary : m.summary)
    return `<li data-search="${escape([m.name, m.summary, m.summaryTr ?? '', ...m.tags].join(' ').toLowerCase())}" data-reach="${m.reach}"><a href="${here}mods/${m.name}.html" title="${title}"${at}><span class="dot ${m.reach}"></span>${escape(m.name)}</a></li>`
  }).join('')
  const filters = ['all', 'L0', 'L1', 'L2', 'L3'].map(level => {
    const label = level === 'all' ? escape(c.allReach) : level
    return `<button data-reach="${level}" aria-pressed="${level === 'all'}">${label}</button>`
  }).join('')
  return `<aside class="side">
  <a class="brand" href="${here}index.html">${escape(copy.site.title)}<span>${escape(copy.site.marketplace)}</span></a>
  <input type="search" id="side-q" placeholder="${escape(c.searchPlaceholder)}" autocomplete="off">
  <div class="filters">${filters}</div>
  <h4>${escape(c.modsTitle)} <span id="side-count">(${list.length})</span></h4>
  <nav><ol id="side-list">${rows}</ol></nav>
  <div class="foot"><a href="${REPO}">GitHub</a><a href="${copy.site.author.url}">${escape(copy.site.author.name)}</a></div>
</aside>`
}

/** The language switch: a link to the same page in each language, the page's own marked current. */
function langLinks(lang, path, root) {
  return LANGS.map(l => {
    const at = l.lang === lang ? ' aria-current="true"' : ''
    return `<a href="${root}${l.dir}${path}" hreflang="${l.lang}" lang="${l.lang}"${at}>${l.lang.toUpperCase()}</a>`
  }).join('')
}

/**
 * One page in one language. `path` is the page's place inside a language directory (`index.html`,
 * `mods/x.html`); the head names its canonical URL and the same page in every other language.
 */
function page({ lang, path, title, description, list, current, body }) {
  const full = dirOf(lang) + path
  const root = upTo(full)
  const here = root + dirOf(lang)
  const links = alternates(path).map(a => `<link rel="alternate" hreflang="${a.hreflang}" href="${a.href}">`).join('\n')
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<meta name="description" content="${escape(description)}">
<link rel="canonical" href="${urlOf(full)}">
${links}
<link rel="icon" href="${root}favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="${root}style.css">
</head>
<body>
<div class="shell">
${sidebar(list, current, lang, root)}
<div class="main">
  <header class="top"><div class="inner">
    <a href="${here}index.html#install">${escape(copy[lang].installTitle)}</a>
    <a href="${here}index.html#reach">${escape(copy[lang].reachTitle)}</a>
    <nav class="langs">${langLinks(lang, path, root)}</nav>
  </div></header>
${body}
  <footer class="bottom"><div class="wrap">
    <p>${escape(copy[lang].generated)}</p>
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

function hero(list, lang) {
  const at = level => list.filter(m => m.reach === level).length
  return `<div class="wrap"><div class="hero">
  <h1>${escape(copy.site.title)}</h1>
  <p class="tagline">${escape(copy[lang].tagline)}</p>
  <p class="lead">${escape(copy[lang].lead)}</p>
  <div class="counts">
    <div><b>${list.length}</b>mod</div>
    <div><b>${at('L0') + at('L1')}</b>L0 + L1</div>
    <div><b>${at('L2')}</b>L2</div>
    <div><b>${at('L3')}</b>L3</div>
  </div>
</div></div>`
}

function indexPage(list, lang) {
  const c = copy[lang]
  const body = `<main>
${hero(list, lang)}
<div class="wrap">
  <section id="install">
    <h2>${escape(c.installTitle)}</h2>
    ${installBlock(lang)}
  </section>
  <section id="reach">
    <h2>${escape(c.reachTitle)}</h2>
    ${reachList(lang)}
    <p class="sub" style="margin-top:18px">${escape(c.docsNote)}</p>
  </section>
</div>
</main>`
  return page({ lang, path: 'index.html', title: copy.site.title, description: c.tagline, list, current: null, body })
}

/** A mod's page body: its README in the page's language; a mod with no Turkish README shows the English one with a note. */
function modBody(mod, lang) {
  if (lang === 'en' || mod.readmeTr === null) {
    const note = lang === 'tr' ? `<p class="sub">${escape(copy.tr.noTurkish)}</p>` : ''
    return note + markdown(mod.readme, mod.name)
  }
  return markdown(mod.readmeTr, mod.name)
}

function modPage(mod, list, lang) {
  const body = `<main class="wrap"><article class="doc">
  <div class="docbar">
    <span class="reach ${mod.reach}">${mod.reach}</span>
    <span class="version">v${escape(mod.version)}</span>
    <a href="${REPO}/tree/main/plugins/${mod.name}">source</a>
  </div>
  ${modBody(mod, lang)}
</article></main>`
  const description = lang === 'tr' ? mod.summaryTr ?? mod.summary : mod.summary
  return page({ lang, path: `mods/${mod.name}.html`, title: `${mod.name} · ${copy.site.title}`, description, list, current: mod.name, body })
}

const SCRIPT = `// The sidebar's filter. No framework and no storage: the language is the page's own URL.
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

// The open mod is scrolled into view in a long sidebar.
document.querySelector('#side-list a[aria-current="page"]')?.scrollIntoView({ block: 'center' })
`

/** Every page as its path inside a language directory, with the time it last changed. */
function pagesOf(list) {
  const index = { path: 'index.html', lastmod: lastCommit([...TEMPLATE, '.claude-plugin/marketplace.json']) }
  return [index, ...list.map(m => ({ path: `mods/${m.name}.html`, lastmod: m.lastmod }))]
}

/** One entry per page and language, each naming every language's URL of that page, as Google reads hreflang. */
function sitemap(pages) {
  const entries = pages.flatMap(p => {
    const links = alternates(p.path).map(a => `<xhtml:link rel="alternate" hreflang="${a.hreflang}" href="${a.href}"/>`).join('')
    return LANGS.map(l => `  <url><loc>${urlOf(l.dir + p.path)}</loc><lastmod>${p.lastmod}</lastmod>${links}</url>`)
  })
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`
}

async function writePages(list) {
  for (const { lang, dir } of LANGS) {
    await mkdir(join(OUT, dir, 'mods'), { recursive: true })
    await writeFile(join(OUT, dir, 'index.html'), indexPage(list, lang))
    for (const mod of list) await writeFile(join(OUT, dir, 'mods', `${mod.name}.html`), modPage(mod, list, lang))
  }
}

async function build() {
  const list = await mods()
  // The output is generated, so it is thrown away and written again rather than merged.
  await rm(OUT, { recursive: true, force: true })
  await writePages(list)
  await copyFile(join(DOCS, 'style.css'), join(OUT, 'style.css'))
  await copyFile(join(DOCS, 'favicon.svg'), join(OUT, 'favicon.svg'))
  await writeFile(join(OUT, 'site.js'), SCRIPT)
  await writeFile(join(OUT, 'CNAME'), `${copy.site.domain}\n`)
  await writeFile(join(OUT, '.nojekyll'), '')
  await writeFile(join(OUT, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: https://${copy.site.domain}/sitemap.xml\n`)
  await writeFile(join(OUT, 'sitemap.xml'), sitemap(pagesOf(list)))
  const translated = list.filter(m => m.readmeTr !== null).length
  console.log(`site: ${list.length} mods in ${LANGS.length} languages, ${translated} with a Turkish README`)
}

await build()
