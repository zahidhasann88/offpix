// Fails if dist/ breaks Cloudflare Pages limits: 25 MiB per file, 20,000 files per deploy.
// `pnpm build:pages` is made to fit; the full build is not.
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MAX_FILE = 25 * 1024 * 1024
const MAX_FILES = 20000
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')

if (!fs.existsSync(dist)) {
  console.error('dist/ not found; run `pnpm build` first.')
  process.exit(1)
}

const files = []
const walk = dir => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p)
    else files.push({ p: path.relative(dist, p).split(path.sep).join('/'), size: fs.statSync(p).size })
  }
}
walk(dist)

const mib = n => `${(n / 1048576).toFixed(1)} MiB`
const tooBig = files.filter(f => f.size > MAX_FILE).sort((a, b) => b.size - a.size)
const total = files.reduce((a, f) => a + f.size, 0)
console.log(`dist: ${files.length} files, ${mib(total)}`)

let ok = true
const MAX_PART = 20 * 1024 * 1024
for (const f of files.filter(x => x.p.endsWith('.parts.json'))) {
  const pm = JSON.parse(fs.readFileSync(path.join(dist, f.p), 'utf8'))
  const whole = crypto.createHash('sha256')
  let total = 0
  for (const part of pm.parts) {
    const p = path.join(dist, part.url.replace(/^\//, ''))
    if (!fs.existsSync(p)) { console.error(`${f.p}: missing part ${part.url}`); ok = false; continue }
    const data = fs.readFileSync(p)
    if (data.length > MAX_PART) { console.error(`${part.url}: ${mib(data.length)} exceeds the 20 MiB part size`); ok = false }
    if (crypto.createHash('sha256').update(data).digest('hex') !== part.sha256) { console.error(`${part.url}: sha256 mismatch`); ok = false }
    whole.update(data); total += data.length
  }
  const sha = whole.digest('hex')
  if (total !== pm.size || sha !== pm.sha256) { console.error(`${f.p}: parts reassemble to ${total} bytes / ${sha}, expected ${pm.size} / ${pm.sha256}`); ok = false }
  else console.log(`${f.p}: ${pm.parts.length} parts, reassembled sha256 ok`)
}
if (files.length > MAX_FILES) {
  console.error(`Too many files: ${files.length} > ${MAX_FILES}`)
  ok = false
}
if (tooBig.length) {
  console.error(`\nThese files exceed Cloudflare Pages' 25 MiB per-file limit:`)
  for (const f of tooBig) console.error(`  ${mib(f.size).padStart(10)}  ${f.p}`)
  console.error(`\nHost them elsewhere (e.g. an R2 bucket) or remove them from the build.`)
  ok = false
}
if (!ok) process.exit(1)
console.log('OK: within Cloudflare Pages limits')
