// Models we build ourselves (BiRefNet Lite 512 fp16) are published as GitHub Release assets:
// the same <= 20 MiB parts and parts manifest the Pages build serves, so no binary ever enters
// normal git history. src/models/manifest.json stays the single source of truth: each such model
// has `release: { tag, parts: [{ name, size, sha256 }] }`, and the parts manifest asset is exactly
// what the build writes (see build/offpix-plugins.ts writeParts).
//
//   node scripts/release-models.mjs pack [--update-manifest]
//       split the local public/models files into release-assets/ (gitignored) and print the
//       `gh release` commands; --update-manifest writes the part list into the manifest.
//   node scripts/release-models.mjs fetch --repo <owner/name> | --from <dir>
//       download every part (or read them from <dir>), verify each size + sha256 and the
//       parts manifest, assemble public/models/<file> and verify the whole file. Any missing
//       part or mismatch exits 1 (the deploy uses this).
//   node scripts/release-models.mjs check --repo <owner/name> | --from <dir>
//       the same verification without writing the model (CI: manifest vs published files).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(root, 'src/models/manifest.json')
const PART_SIZE = 20 * 1024 * 1024 // keep in sync with src/engine/parts.ts
const OUT = path.join(root, 'release-assets')

const sha = buf => crypto.createHash('sha256').update(buf).digest('hex')
const arg = name => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined }
const fileName = m => m.url.replace(/^\/models\//, '')

export function partsManifest(m, parts) {
  return JSON.stringify({ size: m.size, sha256: m.sha256, parts: parts.map(p => ({ url: `/models/${p.name}`, size: p.size, sha256: p.sha256 })) }, null, 2)
}

function split(m, data) {
  const parts = []
  for (let start = 0, k = 0; start < data.length; start += PART_SIZE, k++) {
    const chunk = data.subarray(start, Math.min(data.length, start + PART_SIZE))
    parts.push({ name: `${fileName(m)}.part${String(k).padStart(3, '0')}`, size: chunk.length, sha256: sha(chunk), chunk })
  }
  return parts
}

async function readAsset(name, { repo, from, tag }) {
  if (from) {
    const p = path.join(from, name)
    if (!fs.existsSync(p)) throw new Error(`missing asset ${name} in ${from}`)
    return fs.readFileSync(p)
  }
  const url = `https://github.com/${repo}/releases/download/${tag}/${name}`
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`missing asset ${name}: HTTP ${res.status} for ${url}`)
  return Buffer.from(await res.arrayBuffer())
}

async function verify(write) {
  const repo = arg('--repo') ?? process.env.GITHUB_REPOSITORY, from = arg('--from')
  if (!repo && !from) throw new Error('need --repo <owner/name> (or GITHUB_REPOSITORY) or --from <dir>')
  const models = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).models.filter(m => m.release)
  if (!models.length) throw new Error('no model in the manifest has a `release` entry')
  let failed = 0
  for (const m of models) {
    const src = { repo, from, tag: m.release.tag }
    try {
      const pm = (await readAsset(`${fileName(m)}.parts.json`, src)).toString('utf8')
      if (JSON.stringify(JSON.parse(pm)) !== JSON.stringify(JSON.parse(partsManifest(m, m.release.parts)))) throw new Error('published parts manifest differs from src/models/manifest.json')
      const chunks = []
      for (const p of m.release.parts) {
        const b = await readAsset(p.name, src)
        if (b.length !== p.size) throw new Error(`${p.name}: size ${b.length} != ${p.size}`)
        const h = sha(b)
        if (h !== p.sha256) throw new Error(`${p.name}: sha256 ${h} != ${p.sha256}`)
        chunks.push(b)
        console.log(`ok: ${p.name}`)
      }
      const whole = Buffer.concat(chunks)
      if (whole.length !== m.size || sha(whole) !== m.sha256) throw new Error(`assembled ${fileName(m)} does not match the manifest`)
      if (write) {
        const out = path.join(root, 'public', m.url.replace(/^\//, ''))
        fs.mkdirSync(path.dirname(out), { recursive: true })
        fs.writeFileSync(out, whole)
      }
      console.log(`ok: ${m.id} (${m.release.tag}, ${m.release.parts.length} parts)${write ? ' -> public' + m.url : ''}`)
    } catch (e) {
      console.error(`FAIL: ${m.id}: ${e.message}`)
      failed++
    }
  }
  if (failed) process.exit(1)
}

function pack() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const tag = arg('--tag') ?? 'models-v1'
  fs.mkdirSync(OUT, { recursive: true })
  const names = []
  for (const m of manifest.models.filter(x => x.pagesParts)) {
    const file = path.join(root, 'public', m.url.replace(/^\//, ''))
    const data = fs.readFileSync(file)
    if (data.length !== m.size || sha(data) !== m.sha256) throw new Error(`${m.id}: ${file} does not match the manifest`)
    const parts = split(m, data)
    for (const p of parts) { fs.writeFileSync(path.join(OUT, p.name), p.chunk); names.push(p.name) }
    const meta = parts.map(({ name, size, sha256 }) => ({ name, size, sha256 }))
    fs.writeFileSync(path.join(OUT, `${fileName(m)}.parts.json`), partsManifest(m, meta))
    names.push(`${fileName(m)}.parts.json`)
    if (m.release && JSON.stringify(m.release.parts) !== JSON.stringify(meta) && !process.argv.includes('--update-manifest')) throw new Error(`${m.id}: manifest release parts differ; rerun with --update-manifest`)
    m.release = { tag, parts: meta }
  }
  if (process.argv.includes('--update-manifest')) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  console.log(`wrote ${names.length} assets to release-assets/. Publish with:`)
  console.log(`  gh release create ${tag} --title "Models ${tag}" --notes "Model parts; hashes in src/models/manifest.json" ${names.map(n => `release-assets/${n}`).join(' ')}`)
}

const cmd = process.argv[2]
if (cmd === 'pack') pack()
else if (cmd === 'fetch') await verify(true)
else if (cmd === 'check') await verify(false)
else { console.error('usage: release-models.mjs pack [--update-manifest] [--tag t] | fetch|check --repo owner/name | --from dir'); process.exit(2) }
