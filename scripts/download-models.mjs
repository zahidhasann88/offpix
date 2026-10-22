import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/models/manifest.json'), 'utf8'))
const pagesOnly = process.argv.includes('--pages')
const PAGES_FILE_LIMIT = 25 * 1024 * 1024

async function sha256File(p) {
  const h = crypto.createHash('sha256')
  const s = fs.createReadStream(p)
  for await (const c of s) h.update(c)
  return h.digest('hex')
}

const files = manifest.models.flatMap(m => (m.webgpuFile ? [m, { ...m, id: `${m.id} (webgpu)`, ...m.webgpuFile }] : [m]))
for (const m of files) {
  if (pagesOnly && m.size > PAGES_FILE_LIMIT) {
    console.log(`skip (not in pages profile): ${m.id}`)
    continue
  }
  const outPath = path.join(root, 'public', m.url.replace(/^\//, ''))
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  if (fs.existsSync(outPath)) {
    const h = await sha256File(outPath)
    if (h === m.sha256) {
      console.log(`skip (valid): ${m.id}`)
      continue
    }
    console.log(`re-download (bad hash): ${m.id}`)
  }
  if (m.export) {
    console.warn(`skip: ${m.id} is built by ${m.export.script} from ${m.export.checkpoint.url} (see scripts/requirements-export.txt)${m.release ? `; published as release ${m.release.tag}: node scripts/release-models.mjs fetch --repo <owner/name>` : ''}`)
    continue
  }
  const src = m.derivedFrom ?? m
  const dlPath = m.derivedFrom ? `${outPath}.official` : outPath
  console.log(`downloading ${m.id} (${src.size} bytes)...`)
  const res = await fetch(src.downloadUrl)
  if (!res.ok) throw new Error(`${m.id}: HTTP ${res.status}`)
  fs.writeFileSync(dlPath, Buffer.from(await res.arrayBuffer()))
  const hs = await sha256File(dlPath)
  if (hs !== src.sha256) {
    fs.unlinkSync(dlPath)
    throw new Error(`${m.id}: sha256 mismatch ${hs} != ${src.sha256}`)
  }
  if (m.derivedFrom) {
    // Needs python with the onnx package; CI does not use these models, so skip without it.
    const script = path.join(root, m.derivedFrom.patch.split(' ')[0])
    const r = spawnSync('python', [script, dlPath, outPath], { stdio: 'inherit' })
    fs.unlinkSync(dlPath)
    if (r.status !== 0) {
      console.warn(`skip: ${m.id} needs python + onnx to run ${m.derivedFrom.patch}`)
      continue
    }
  }
  const h = await sha256File(outPath)
  if (h !== m.sha256) {
    fs.unlinkSync(outPath)
    throw new Error(`${m.id}: sha256 mismatch ${h} != ${m.sha256}`)
  }
  console.log(`ok: ${m.id}`)
}
console.log('all models ready')
