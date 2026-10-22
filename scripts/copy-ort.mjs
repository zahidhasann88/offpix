// Self-host the ONNX Runtime wasm runtime under public/ort (configured via
// ort.env.wasm.wasmPaths). Two builds are needed: JSEP (WASM + WebGPU, 27 MiB) for the full
// profile and plain WASM (14 MiB) for the Cloudflare Pages profile; the build removes the
// pair its profile doesn't load (see build/offpix-plugins.ts).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const src = path.join(root, 'node_modules/onnxruntime-web/dist')
const dst = path.join(root, 'public/ort')
const files = [
  'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm',
  'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm',
]
fs.rmSync(dst, { recursive: true, force: true })
fs.mkdirSync(dst, { recursive: true })
for (const f of files) fs.copyFileSync(path.join(src, f), path.join(dst, f))
console.log(`copied ${files.length} ort runtime files to public/ort`)
