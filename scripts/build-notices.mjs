// Generates THIRD_PARTY_NOTICES.md (repo root, and public/ so the About dialog can link it):
// full license texts and copyright lines for every shipped model and bundled dependency.
//   node scripts/build-notices.mjs          write
//   node scripts/build-notices.mjs --check  exit 1 if the committed file is out of date
// Model license texts are pinned copies in public/licenses/ (sources below); dependency texts
// come from the installed packages (exact versions from the lockfile).
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'src/models/manifest.json'), 'utf8'))
const lic = f => fs.readFileSync(path.join(root, 'public/licenses', f), 'utf8').trim()

const UPSTREAM = {
  birefnet: { title: 'BiRefNet (ZhengPeng7)', file: 'BiRefNet.LICENSE', spdx: 'MIT', copyright: 'Copyright (c) 2024 ZhengPeng', from: 'https://github.com/ZhengPeng7/BiRefNet/blob/97e4f35d74043427b0e9ba935ca10991853a36bc/LICENSE' },
  u2net: { title: 'U-2-Net (Xuebin Qin et al.)', file: 'U-2-Net.LICENSE', spdx: 'Apache-2.0', copyright: 'The upstream LICENSE carries no copyright line (the Apache template line is unfilled); authors: Xuebin Qin, Zichen Zhang, Chenyang Huang, Masood Dehghan, Osmar R. Zaiane, Martin Jagersand. No NOTICE file upstream.', from: 'https://github.com/xuebinqin/U-2-Net/blob/ac7e1c817ecab7c7dff5ce6b1abba61cd213ff29/LICENSE' },
  dis: { title: 'DIS / IS-Net (Xuebin Qin et al.)', file: 'DIS.LICENSE', spdx: 'Apache-2.0', copyright: 'The upstream LICENSE carries no copyright line (the Apache template line is unfilled); authors: Xuebin Qin, Hang Dai, Xiaobin Hu, Deng-Ping Fan, Ling Shao, Luc Van Gool. No NOTICE file upstream.', from: 'https://github.com/xuebinqin/DIS/blob/b6764e20381f6f42a70f83fa3324181529ed1403/LICENSE.md' },
  rembg: { title: 'rembg ONNX exports (Daniel Gatis)', file: 'rembg.LICENSE', spdx: 'MIT', copyright: 'See the license text below.', from: 'https://github.com/danielgatis/rembg/blob/cd8f3665dda6c246b5baecb85fda6a2acd644c2a/LICENSE.txt' },
  esrgan: { title: 'Real-ESRGAN (Xintao Wang)', file: 'Real-ESRGAN.LICENSE', spdx: 'BSD-3-Clause', copyright: 'See the license text below. The ONNX exports (huggingface.co/CoderViking/realesr-general-x4v3-onnx, huggingface.co/SceneWorks/real-esrgan-onnx) declare BSD-3-Clause.', from: 'https://github.com/xinntao/Real-ESRGAN/blob/v0.2.5.0/LICENSE' },
  yolox: { title: 'YOLOX (Megvii)', file: 'YOLOX.LICENSE', spdx: 'Apache-2.0', copyright: 'Copyright 2021 Megvii, Base Detection. No NOTICE file upstream.', from: 'https://github.com/Megvii-BaseDetection/YOLOX/blob/0.1.1rc0/LICENSE' },
}

const MODEL_LICENSES = {
  'u2netp': ['u2net', 'rembg'],
  'isnet-general-use': ['dis', 'rembg'],
  'birefnet-lite-512': ['birefnet'],
  'birefnet-lite-1024': ['birefnet'],
  'realesr-general-x4v3': ['esrgan'],
  'real-esrgan-x2': ['esrgan'],
  'real-esrgan-x4': ['esrgan'],
  'yolox-nano': ['yolox'],
  'yolox-tiny': ['yolox'],
}

const DEPS = ['react', 'react-dom', 'scheduler', 'comlink', 'fast-png', 'iobuffer', 'fflate', '@fontsource-variable/inter', 'lucide-react',
  'onnxruntime-web', 'onnxruntime-common', 'flatbuffers', 'guid-typescript', 'long', 'platform', 'protobufjs',
  '@protobufjs/aspromise', '@protobufjs/base64', '@protobufjs/codegen', '@protobufjs/eventemitter', '@protobufjs/fetch',
  '@protobufjs/float', '@protobufjs/path', '@protobufjs/pool', '@protobufjs/utf8']

let tree = null
function pkgDir(name) {
  if (!tree) {
    tree = new Map()
    const walk = deps => { for (const [n, d] of Object.entries(deps ?? {})) { if (!tree.has(n)) tree.set(n, d.path); walk(d.dependencies) } }
    walk(JSON.parse(execSync('pnpm list --prod --depth Infinity --json', { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }))[0].dependencies)
  }
  const dir = tree.get(name)
  if (!dir) throw new Error(`${name} is not a production dependency (pnpm list --prod)`)
  return dir
}

function depText(name, dir, pj) {
  const f = fs.readdirSync(dir).find(x => /^(licen[cs]e|copying)/i.test(x))
  if (f) return fs.readFileSync(path.join(dir, f), 'utf8').trim()
  if (name.startsWith('onnxruntime-')) return lic('onnxruntime.LICENSE')
  if (pj.license === 'ISC') {
    const who = typeof pj.author === 'string' ? pj.author : pj.author?.name ?? 'the authors'
    return `ISC License\n\nCopyright (c) ${who}\n\nPermission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.\n\nTHE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.\n\n(The package ships no license file; this is the standard ISC text its package.json declares.)`
  }
  throw new Error(`${name}: no license text`)
}

const fence = t => '```text\n' + t.replace(/```/g, "'''") + '\n```'

export function build() {
  // Every direct production dependency must be listed (a new package cannot slip in unnoticed).
  const direct = Object.keys(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies ?? {})
  const missing = direct.filter(d => !DEPS.includes(d))
  if (missing.length) throw new Error(`add to DEPS in scripts/build-notices.mjs: ${missing.join(', ')}`)
  const out = []
  out.push('# Third-party notices', '',
    'offpix itself is MIT licensed (see LICENSE). It ships the models and libraries below; each keeps its own license.',
    'Generated by `scripts/build-notices.mjs` from pinned copies (`public/licenses/`) and the installed packages.', '')
  out.push('## Models', '')
  for (const m of manifest.models) {
    const keys = MODEL_LICENSES[m.id]
    if (!keys) throw new Error(`model ${m.id} has no license mapping in scripts/build-notices.mjs`)
    out.push(`### ${m.id}`, '', `${m.name}. Manifest license: ${m.license}.`, '')
    for (const k of keys) out.push(`- ${UPSTREAM[k].title}: ${UPSTREAM[k].spdx}, full text under "Model licenses" below (${k}).`)
    out.push('')
  }
  out.push('## Model licenses', '')
  for (const [k, u] of Object.entries(UPSTREAM)) {
    out.push(`### ${u.title} (${k})`, '', `License: ${u.spdx}. ${u.copyright}`, `Source: ${u.from}`, '', fence(lic(u.file)), '')
  }
  out.push('## Libraries bundled with the app', '')
  for (const name of DEPS) {
    const dir = pkgDir(name)
    const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'))
    out.push(`### ${name} ${pj.version}`, '', `License: ${pj.license}.`, '', fence(depText(name, dir, pj)), '')
    if (name === 'onnxruntime-web') {
      out.push('The ONNX Runtime WebAssembly binaries also contain third-party code. Their notices, in full, are in',
        '[licenses/onnxruntime.ThirdPartyNotices.txt](licenses/onnxruntime.ThirdPartyNotices.txt)',
        '(from https://github.com/microsoft/onnxruntime/blob/v1.30.0/ThirdPartyNotices.txt).', '')
    }
  }
  return out.join('\n').replace(/\r\n?/g, '\n')
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const text = build()
  const targets = ['THIRD_PARTY_NOTICES.md', 'public/THIRD_PARTY_NOTICES.md'].map(f => path.join(root, f))
  if (process.argv.includes('--check')) {
    const stale = targets.filter(f => !fs.existsSync(f) || fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n') !== text)
    if (stale.length) { console.error(`out of date: ${stale.join(', ')} (run node scripts/build-notices.mjs)`); process.exit(1) }
    console.log('notices up to date')
  } else {
    for (const f of targets) fs.writeFileSync(f, text)
    console.log(`wrote ${targets.length} files, ${text.length} chars`)
  }
}
