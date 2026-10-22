import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { Plugin, ResolvedConfig } from 'vite'

const CSP = {
  'default-src': ["'self'"],
  // wasm-unsafe-eval: ONNX Runtime compiles its WebAssembly. No other eval, no inline script.
  'script-src': ["'self'", "'wasm-unsafe-eval'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'blob:', 'data:'],
  'font-src': ["'self'"],
  // Models and runtime are self-hosted, so nothing but this origin is ever contacted.
  'connect-src': ["'self'"],
  'worker-src': ["'self'", 'blob:'],
  'manifest-src': ["'self'"],
  'base-uri': ["'self'"],
  'form-action': ["'none'"],
  'object-src': ["'none'"],
}

export function cspString(mode: 'dev' | 'prod', withFrameAncestors: boolean): string {
  const policy: Record<string, string[]> = { ...CSP }
  // Vite's dev server injects <style> tags for HMR.
  if (mode === 'dev') policy['style-src'] = [...CSP['style-src'], "'unsafe-inline'"]
  // frame-ancestors is ignored (with a console warning) in a <meta> CSP.
  if (withFrameAncestors) policy['frame-ancestors'] = ["'none'"]
  return Object.entries(policy).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ')
}

function headersFile(): string {
  return `/*
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Embedder-Policy: require-corp
  Content-Security-Policy: ${cspString('prod', true)}
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=()

/assets/*
  Cache-Control: public, max-age=31536000, immutable

/sw.js
  Cache-Control: no-cache
`
}

export function cspPlugin(): Plugin {
  let isBuild = false
  return {
    name: 'offpix-csp',
    configResolved(c) { isBuild = c.command === 'build' },
    transformIndexHtml() {
      // Build: first in <head> so it covers everything. Dev: after Vite's inline React Refresh
      // preamble, which would otherwise be blocked (production has no inline scripts).
      return [{
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: cspString(isBuild ? 'prod' : 'dev', false) },
        injectTo: isBuild ? 'head-prepend' : 'head',
      }]
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: '_headers', source: headersFile() })
    },
  }
}

const PUBLIC_SHELL = ['manifest.webmanifest', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png']

export function serviceWorkerPlugin(): Plugin {
  let config: ResolvedConfig
  return {
    name: 'offpix-sw',
    apply: 'build',
    configResolved(c) { config = c },
    generateBundle(_, bundle) {
      const base = config.base
      const built = Object.keys(bundle).filter(f => f !== '_headers' && !f.endsWith('.map'))
      const files = [...new Set(['', 'index.html', ...built, ...PUBLIC_SHELL])].map(f => base + f)
      const version = crypto.createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12)
      const template = fs.readFileSync(path.resolve(config.root, 'build/sw-template.js'), 'utf8')
      const source = template
        .replace('__VERSION__', version)
        .replace('__BASE__', base)
        .replace('__PRECACHE__', JSON.stringify(files, null, 2))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

export type Profile = 'full' | 'pages'
const PAGES_FILE_LIMIT = 25 * 1024 * 1024
const ORT_PAIRS = {
  jsep: ['ort/ort-wasm-simd-threaded.jsep.mjs', 'ort/ort-wasm-simd-threaded.jsep.wasm'],
  wasm: ['ort/ort-wasm-simd-threaded.mjs', 'ort/ort-wasm-simd-threaded.wasm'],
}

const PART_SIZE = 20 * 1024 * 1024 // keep in sync with src/engine/parts.ts

interface ManifestModel { id: string; url: string; size: number; sha256: string; pagesParts?: boolean; webgpuFile?: { url: string; size: number }; release?: { tag: string; parts: { name: string; size: number; sha256: string }[] } }

function readManifest(root: string): ManifestModel[] {
  return (JSON.parse(fs.readFileSync(path.resolve(root, 'src/models/manifest.json'), 'utf8')) as { models: ManifestModel[] }).models
}

/**
 * Models the pages profile ships as parts: flagged `pagesParts` AND present in public/models
 * (they are built by scripts/export-birefnet.py, not downloaded, so CI may not have them).
 * Passed to the app as __OFFPIX_PAGES_PARTS__ so it never offers a model whose files are missing.
 */
export function pagesPartModels(root: string): string[] {
  return readManifest(root).filter(m => m.pagesParts && fs.existsSync(path.resolve(root, 'public', m.url.replace(/^\//, '')))).map(m => m.id)
}

function writeParts(root: string, outDir: string, m: ManifestModel): string[] {
  const rel = m.url.replace(/^\//, '')
  const data = fs.readFileSync(path.resolve(root, 'public', rel))
  const whole = crypto.createHash('sha256').update(data).digest('hex')
  if (whole !== m.sha256 || data.length !== m.size) throw new Error(`${m.id}: public/${rel} does not match the manifest`)
  const parts: { url: string; size: number; sha256: string }[] = []
  const written: string[] = []
  for (let start = 0, k = 0; start < data.length; start += PART_SIZE, k++) {
    const chunk = data.subarray(start, Math.min(data.length, start + PART_SIZE))
    const partRel = `${rel}.part${String(k).padStart(3, '0')}`
    fs.writeFileSync(path.join(outDir, partRel), chunk)
    parts.push({ url: `/${partRel}`, size: chunk.length, sha256: crypto.createHash('sha256').update(chunk).digest('hex') })
    written.push(partRel)
  }
  const listed = m.release?.parts.map(p => ({ url: `/models/${p.name}`, size: p.size, sha256: p.sha256 }))
  if (listed && JSON.stringify(listed) !== JSON.stringify(parts)) throw new Error(`${m.id}: parts differ from the manifest's release ${m.release!.tag} (run scripts/release-models.mjs pack)`)
  fs.writeFileSync(path.join(outDir, `${rel}.parts.json`), JSON.stringify({ size: m.size, sha256: m.sha256, parts }, null, 2))
  written.push(`${rel}.parts.json`)
  return written
}

export function profileAssetsPlugin(profile: Profile): Plugin {
  let config: ResolvedConfig
  return {
    name: 'offpix-profile-assets',
    apply: 'build',
    configResolved(c) { config = c },
    closeBundle() {
      const outDir = path.resolve(config.root, config.build.outDir)
      const manifest = { models: readManifest(config.root) }
      for (const f of profile === 'pages' ? ORT_PAIRS.jsep : ORT_PAIRS.wasm) fs.rmSync(path.join(outDir, f), { force: true })
      // Models: an allow-list. Only files the manifest references ship (the pages profile only
      // those within the file limit); anything else in public/models (old, probe or derived
      // files) never reaches the build.
      const keep = new Set(manifest.models.flatMap(m => [m, ...(m.webgpuFile ? [m.webgpuFile] : [])])
        .filter(f => profile !== 'pages' || f.size <= PAGES_FILE_LIMIT)
        .map(f => path.normalize(f.url.replace(/^\//, ''))))
      if (profile === 'pages') {
        const partIds = new Set(pagesPartModels(config.root))
        for (const m of manifest.models.filter(x => partIds.has(x.id))) for (const p of writeParts(config.root, outDir, m)) keep.add(path.normalize(p))
      }
      const modelsDir = path.join(outDir, 'models')
      if (fs.existsSync(modelsDir)) {
        for (const f of fs.readdirSync(modelsDir, { recursive: true }) as string[]) {
          const rel = path.normalize(path.join('models', f)), abs = path.join(outDir, rel)
          if (fs.statSync(abs).isFile() && !keep.has(rel)) fs.rmSync(abs)
        }
        for (const d of fs.readdirSync(modelsDir, { withFileTypes: true })) {
          const abs = path.join(modelsDir, d.name)
          if (d.isDirectory() && fs.readdirSync(abs).length === 0) fs.rmdirSync(abs)
        }
      }
    },
  }
}
