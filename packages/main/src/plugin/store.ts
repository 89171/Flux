import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import type { InstalledPluginRecord } from '@shared/types'

/** 用户数据目录下的插件相关路径 */
export function getPluginsRoot(): string {
  const root = join(app.getPath('userData'), 'plugins')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

export function getStorePath(): string {
  return join(app.getPath('userData'), 'plugin-store.json')
}

interface StoreShape {
  plugins: InstalledPluginRecord[]
}

function readStore(): StoreShape {
  const p = getStorePath()
  if (!existsSync(p)) return { plugins: [] }
  try {
    return JSON.parse(readFileSync(p, 'utf-8')) as StoreShape
  } catch {
    return { plugins: [] }
  }
}

function writeStore(data: StoreShape): void {
  writeFileSync(getStorePath(), JSON.stringify(data, null, 2), 'utf-8')
}

export function listInstalledPlugins(): InstalledPluginRecord[] {
  return readStore().plugins
}

export function upsertPluginRecord(rec: InstalledPluginRecord): void {
  const store = readStore()
  const idx = store.plugins.findIndex((p) => p.id === rec.id)
  if (idx >= 0) store.plugins[idx] = rec
  else store.plugins.push(rec)
  writeStore(store)
}

export function removePluginRecord(id: string): void {
  const store = readStore()
  store.plugins = store.plugins.filter((p) => p.id !== id)
  writeStore(store)
}

export function findPluginRecord(id: string): InstalledPluginRecord | undefined {
  return readStore().plugins.find((p) => p.id === id)
}
