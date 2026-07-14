import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@plugin-sdk': resolve('src/plugin-sdk')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('src/shared'),
        '@plugin-sdk': resolve('src/plugin-sdk')
      }
    },
    plugins: [react()],
    // Excalidraw 0.17's main.js switches its export via
    // `process.env.IS_PREACT` and `process.env.NODE_ENV`, but the
    // renderer runs sandboxed with no Node globals — `process` is
    // undefined. Replace both refs at bundle time (dev + prod, incl.
    // esbuild's dep-optimize pass) so the code collapses to a plain
    // require of the shipped bundle before it ever hits the browser.
    //
    // EXCALIDRAW_ASSET_PATH: Excalidraw reads this at module init time to
    // decide where to fetch lazy chunks (fonts, vendor JS). Default is
    // unpkg.com CDN, which our CSP blocks. Setting '/' here (replaced at
    // bundle time so it wins the || check) makes Excalidraw load from
    // /excalidraw-assets/ (prod) or /excalidraw-assets-dev/ (dev), which
    // are copied from node_modules to src/renderer/public/ by the
    // predev/prebuild hook and served by Vite / Electron at the same
    // origin — allowed by script-src 'self'.
    define: {
      'process.env.IS_PREACT': JSON.stringify('false'),
      'process.env.NODE_ENV': JSON.stringify(
        process.env.NODE_ENV === 'production' ? 'production' : 'development'
      ),
      'window.EXCALIDRAW_ASSET_PATH': JSON.stringify('/')
    },
    optimizeDeps: {
      // Force pre-bundling for these — they're CJS-only and need
      // esbuild to normalise `require()` before the app boots.
      include: ['@excalidraw/excalidraw']
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          note: resolve(__dirname, 'src/renderer/note.html'),
          devGuide: resolve(__dirname, 'src/renderer/plugin-dev-guide.html')
        }
      }
    }
  }
})
