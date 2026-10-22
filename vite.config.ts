import { defineConfig, defaultClientConditions } from 'vite'
import react from '@vitejs/plugin-react'
import { cspPlugin, serviceWorkerPlugin, profileAssetsPlugin, pagesPartModels, type Profile } from './build/offpix-plugins.ts'

const isolationHeaders = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
}

export default defineConfig(({ mode }) => {
  const profile: Profile = mode === 'pages' ? 'pages' : 'full'
  return {
    // GitHub Pages serves the site from /<repo>/; the deploy workflow sets OFFPIX_BASE.
    base: process.env.OFFPIX_BASE ?? '/',
    plugins: [react(), cspPlugin(), serviceWorkerPlugin(), profileAssetsPlugin(profile)],
    define: {
      __OFFPIX_PROFILE__: JSON.stringify(profile),
      __OFFPIX_PAGES_PARTS__: JSON.stringify(profile === 'pages' ? pagesPartModels(process.cwd()) : []),
    },
    resolve: {
      // Resolve onnxruntime-web to its "extern wasm" build: the runtime is loaded from the
      // self-hosted public/ort (ort.env.wasm.wasmPaths) instead of a second bundled copy.
      conditions: ['onnxruntime-web-use-extern-wasm', ...defaultClientConditions],
      // The pages profile has no room for the 27 MiB WebGPU runtime: use the WASM-only entry.
      alias: profile === 'pages' ? [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }] : [],
    },
    server: {
      host: '0.0.0.0',
      allowedHosts: true,
      headers: isolationHeaders,
    },
    preview: { headers: isolationHeaders },
    optimizeDeps: { exclude: ['onnxruntime-web'] },
  }
})
