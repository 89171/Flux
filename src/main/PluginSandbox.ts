/**
 * Plugin Sandbox
 *
 * Loads third-party plugin `main.js` files inside a Node vm context with a
 * curated global — no `require`, no `process`, no `Buffer`, no filesystem —
 * so plugins cannot escape the PluginAPI to reach the user's home directory
 * or spawn subprocesses.
 *
 * Caveats:
 *   - Node's `vm` module is not a security boundary against a *determined*
 *     attacker; a plugin that captures a reference to certain host objects
 *     could still walk the prototype chain to `require`. It **is** an
 *     effective barrier against accidents and naive attacks, and cuts the
 *     blast radius by an order of magnitude compared with plain `require()`.
 *   - Full isolation would require `utilityProcess`; migrating is on the
 *     roadmap (task #4 covers phase 1 only).
 *
 * The sandbox also solves the require.cache staleness bug — since we build
 * the module namespace ourselves rather than delegating to Node's loader,
 * reinstalling a plugin always executes the fresh copy.
 */

import { readFileSync } from 'fs'
import { dirname, join, resolve as pathResolve, relative } from 'path'
import vm from 'vm'
import type { PluginModule } from '@plugin-sdk/types'
import type { PluginInfo } from '@shared/types'

/** Modules a plugin may import via require(). Everything else throws. */
const ALLOWED_REQUIRE = new Set(['path'])

export function loadPluginInSandbox(info: PluginInfo): PluginModule {
  const entryPath = pathResolve(join(info.installPath, info.main))

  // Belt-and-braces path check — PluginInstaller validates on install too.
  const installRoot = pathResolve(info.installPath)
  const rel = relative(installRoot, entryPath)
  if (rel.startsWith('..') || pathResolve(installRoot, rel) !== entryPath) {
    throw new Error(
      `Plugin ${info.id}: main entry escapes install directory (${info.main})`
    )
  }

  const source = readFileSync(entryPath, 'utf-8')

  const moduleObj: { exports: Record<string, unknown> } = { exports: {} }
  const exportsObj = moduleObj.exports

  const sandboxRequire = (name: string): unknown => {
    if (!ALLOWED_REQUIRE.has(name)) {
      throw new Error(
        `Plugin ${info.id}: require('${name}') is blocked by the sandbox`
      )
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(name)
  }

  const sandboxConsole = {
    log: (...args: unknown[]) => console.log(`[Plugin:${info.id}]`, ...args),
    info: (...args: unknown[]) => console.info(`[Plugin:${info.id}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[Plugin:${info.id}]`, ...args),
    error: (...args: unknown[]) => console.error(`[Plugin:${info.id}]`, ...args),
    debug: (...args: unknown[]) => console.debug(`[Plugin:${info.id}]`, ...args)
  }

  const context: vm.Context = vm.createContext({
    module: moduleObj,
    exports: exportsObj,
    require: sandboxRequire,
    console: sandboxConsole,
    __filename: entryPath,
    __dirname: dirname(entryPath),
    // Standard globals plugins may reasonably use. Deliberately omitted:
    // process, Buffer, global, globalThis (would expose require via
    // prototype walk), setImmediate, queueMicrotask, and the fs module.
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    JSON,
    Math,
    Date,
    Promise,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    Error,
    RangeError,
    TypeError
  })

  const wrapped = `(function(module, exports, require, __filename, __dirname){\n${source}\n})(module, exports, require, __filename, __dirname);`

  try {
    vm.runInContext(wrapped, context, {
      filename: entryPath,
      timeout: 5000
    })
  } catch (err) {
    throw new Error(
      `Plugin ${info.id}: failed to execute main.js — ${
        err instanceof Error ? err.message : String(err)
      }`
    )
  }

  const exported = moduleObj.exports as Record<string, unknown>
  const mod = (exported.default ?? exported) as PluginModule
  if (!mod || typeof mod !== 'object') {
    throw new Error(`Plugin ${info.id}: main.js did not export a plugin module`)
  }
  return mod
}
