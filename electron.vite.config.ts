import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'packages/main/src/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'packages/shared/src'),
        '@plugin-sdk': resolve(__dirname, 'packages/plugin-sdk/src')
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'packages/preload/src/index.ts') }
      }
    },
    resolve: {
      alias: {
        '@shared': resolve(__dirname, 'packages/shared/src')
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'packages/renderer'),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'packages/renderer/index.html') }
      }
    },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'packages/renderer/src'),
        '@shared': resolve(__dirname, 'packages/shared/src'),
        '@plugin-sdk': resolve(__dirname, 'packages/plugin-sdk/src'),
        '@plugins': resolve(__dirname, 'plugins')
      }
    },
    plugins: [react()]
  }
})
