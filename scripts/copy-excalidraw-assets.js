/**
 * Copies Excalidraw's pre-built asset directories from node_modules into
 * src/renderer/public/ so they are served locally and do not require
 * loading from unpkg.com CDN (which our CSP blocks).
 *
 * Runs automatically via the predev / prebuild npm hooks.
 */
const { cpSync, existsSync, mkdirSync, rmSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const src = join(root, 'node_modules', '@excalidraw', 'excalidraw', 'dist')
const dest = join(root, 'src', 'renderer', 'public')

mkdirSync(dest, { recursive: true })

for (const dir of ['excalidraw-assets', 'excalidraw-assets-dev']) {
  const from = join(src, dir)
  const to = join(dest, dir)
  if (!existsSync(from)) {
    console.warn(`[copy-excalidraw-assets] Source not found: ${from}`)
    continue
  }
  if (existsSync(to)) rmSync(to, { recursive: true, force: true })
  cpSync(from, to, { recursive: true })
  console.log(`[copy-excalidraw-assets] Copied ${dir}`)
}
