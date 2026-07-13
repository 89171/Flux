import { join } from 'path'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import type { PluginManifest, PluginPermission } from '@plugin-sdk/types'

const REQUIRED_FIELDS: (keyof PluginManifest)[] = [
  'id',
  'format',
  'displayName',
  'name',
  'version',
  'main'
]

const VALID_PERMISSIONS: PluginPermission[] = [
  'fs:notes',
  'fs:plugin',
  'ai:generate',
  'window:pin',
  'notification',
  'storage'
]

export interface LoadedManifest {
  manifest: PluginManifest
  pluginDir: string
  entryPath: string // 入口文件绝对路径
}

/**
 * 从插件目录读取并校验 manifest（package.json 的 painote 字段）。
 * 内置插件与第三方插件共用同一套校验规则。
 */
export function loadManifest(pluginDir: string): LoadedManifest {
  const pkgPath = join(pluginDir, 'package.json')
  if (!existsSync(pkgPath)) {
    throw new Error(`[PaiNote Loader] 插件目录缺少 package.json: ${pluginDir}`)
  }

  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
  } catch {
    throw new Error(`[PaiNote Loader] package.json 解析失败: ${pluginDir}`)
  }

  const painote = pkg.painote as Partial<PluginManifest> | undefined
  if (!painote) {
    throw new Error(`[PaiNote Loader] package.json 缺少 painote 字段: ${pluginDir}`)
  }

  const manifest: PluginManifest = {
    id: painote.id ?? (pkg.name as string),
    name: pkg.name as string,
    version: pkg.version as string,
    format: painote.format ?? painote.id ?? '',
    displayName: painote.displayName ?? (pkg.name as string),
    description: painote.description,
    icon: painote.icon,
    author: painote.author ?? (pkg.author as string),
    main: painote.main ?? (pkg.main as string) ?? 'dist/index.js',
    permissions: painote.permissions ?? [],
    minAppVersion: painote.minAppVersion,
    builtin: painote.builtin ?? false
  }

  // 必填校验
  for (const field of REQUIRED_FIELDS) {
    if (!manifest[field]) {
      throw new Error(`[PaiNote Loader] 插件 manifest 缺少必填字段: ${String(field)} (${pluginDir})`)
    }
  }

  // id 格式校验
  if (!/^[a-z0-9-]+$/.test(manifest.id)) {
    throw new Error(`[PaiNote Loader] 插件 id 只能含小写字母/数字/连字符: ${manifest.id}`)
  }

  // 权限白名单校验
  for (const perm of manifest.permissions) {
    if (!VALID_PERMISSIONS.includes(perm)) {
      throw new Error(`[PaiNote Loader] 未知权限声明: ${perm} (插件 ${manifest.id})`)
    }
  }

  const entryPath = join(pluginDir, manifest.main)
  if (!existsSync(entryPath)) {
    throw new Error(`[PaiNote Loader] 插件入口文件不存在: ${entryPath}`)
  }

  return { manifest, pluginDir, entryPath }
}

/** 枚举某目录下所有一级子目录（候选插件目录） */
export function listChildDirs(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .map((name) => join(dir, name))
    .filter((p) => statSync(p).isDirectory())
}
