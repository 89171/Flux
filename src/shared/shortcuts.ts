/**
 * Keyboard-shortcut registry + binding helpers, shared by the renderer's
 * keydown handlers and the Settings UI so both read one source of truth.
 *
 * Canonical binding format: a '+'-joined token string, modifiers first in
 * a fixed order, then exactly one key token. Example: "Mod+Shift+P".
 *   - "Mod"   → Cmd on macOS, Ctrl elsewhere (matches Electron's
 *               CmdOrControl and how the app's handlers test metaKey||ctrlKey)
 *   - "Alt"   → Option / Alt
 *   - "Shift" → Shift (only meaningful for letter keys — see matchShortcut)
 *
 * The key token comes from KeyboardEvent.code (physical key), NOT
 * event.key, so a binding is independent of keyboard layout and of whether
 * Shift alters the produced character (e.g. "=" vs "+"). Tokens: single
 * letters A–Z, digits 0–9, F1–F12, and a small set of punctuation ("=",
 * "-", ",", "." …).
 */

export type ShortcutCategory = 'File' | 'Edit' | 'View' | 'Navigation' | 'General'

export interface ShortcutCommand {
  id: string
  label: string
  category: ShortcutCategory
  /** Canonical default binding, e.g. "Mod+S". */
  defaultBinding: string
}

/**
 * Every user-rebindable command. The `id` is the contract between this
 * registry, the persisted `AppSettings.shortcuts` map, and the action
 * tables in App.tsx / Editor.tsx. Keep ids stable across releases.
 */
export const SHORTCUT_COMMANDS: ShortcutCommand[] = [
  { id: 'save', label: 'Save', category: 'File', defaultBinding: 'Mod+S' },
  { id: 'open-folder', label: 'Open Folder', category: 'File', defaultBinding: 'Mod+O' },

  { id: 'find', label: 'Find', category: 'Edit', defaultBinding: 'Mod+F' },
  { id: 'replace', label: 'Replace', category: 'Edit', defaultBinding: 'Mod+H' },

  { id: 'zoom-in', label: 'Zoom In', category: 'View', defaultBinding: 'Mod+=' },
  { id: 'zoom-out', label: 'Zoom Out', category: 'View', defaultBinding: 'Mod+-' },
  { id: 'zoom-reset', label: 'Reset Zoom', category: 'View', defaultBinding: 'Mod+0' },
  { id: 'toggle-theme', label: 'Toggle Theme', category: 'View', defaultBinding: 'Mod+Shift+T' },

  { id: 'quick-open', label: 'Quick Open', category: 'Navigation', defaultBinding: 'Mod+P' },
  { id: 'command-palette', label: 'Command Palette', category: 'Navigation', defaultBinding: 'Mod+Shift+P' },
  { id: 'global-search', label: 'Global Search', category: 'Navigation', defaultBinding: 'Mod+Shift+F' },

  { id: 'settings', label: 'Open Settings', category: 'General', defaultBinding: 'Mod+,' }
]

/** Default binding map keyed by command id. */
export const DEFAULT_SHORTCUTS: Record<string, string> = SHORTCUT_COMMANDS.reduce(
  (acc, cmd) => {
    acc[cmd.id] = cmd.defaultBinding
    return acc
  },
  {} as Record<string, string>
)

/**
 * Merge persisted overrides over the defaults. Unknown ids in `custom`
 * (from an older/newer build) are ignored so a stale settings file can't
 * inject dead bindings.
 */
export function resolveShortcuts(custom?: Record<string, string>): Record<string, string> {
  const resolved: Record<string, string> = { ...DEFAULT_SHORTCUTS }
  if (custom) {
    for (const cmd of SHORTCUT_COMMANDS) {
      const c = custom[cmd.id]
      if (typeof c === 'string' && c.length > 0) resolved[cmd.id] = c
    }
  }
  return resolved
}

const PUNCT_CODE_TO_TOKEN: Record<string, string> = {
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`'
}

/**
 * Map a KeyboardEvent.code to a canonical key token, or null for keys we
 * don't allow in a shortcut (bare modifiers, and anything unmapped).
 */
export function codeToToken(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3) // KeyF → F
  if (/^Digit[0-9]$/.test(code)) return code.slice(5) // Digit0 → 0
  if (/^F[1-9][0-9]?$/.test(code)) return code // F1..F12
  return PUNCT_CODE_TO_TOKEN[code] ?? null
}

interface ParsedBinding {
  mod: boolean
  alt: boolean
  shift: boolean
  key: string
}

function parseBinding(binding: string): ParsedBinding | null {
  const parts = binding.split('+')
  const key = parts[parts.length - 1]
  if (!key) return null
  return {
    mod: parts.includes('Mod'),
    alt: parts.includes('Alt'),
    shift: parts.includes('Shift'),
    key
  }
}

const isLetterToken = (key: string): boolean => /^[A-Z]$/.test(key)
const isFunctionToken = (key: string): boolean => /^F[1-9][0-9]?$/.test(key)

/**
 * Does this keydown event match the given canonical binding?
 *
 * Shift is compared strictly only for letter keys (so "Mod+P" and
 * "Mod+Shift+P" are distinct commands). For digits / punctuation / function
 * keys Shift is ignored, which keeps "Mod+=" firing on both Cmd+= and
 * Cmd+Shift+= (the historical zoom-in behavior).
 */
export function matchShortcut(e: KeyboardEvent, binding: string): boolean {
  const p = parseBinding(binding)
  if (!p) return false
  const token = codeToToken(e.code)
  if (!token) return false
  if ((e.metaKey || e.ctrlKey) !== p.mod) return false
  if (e.altKey !== p.alt) return false
  if (isLetterToken(p.key) && e.shiftKey !== p.shift) return false
  return token === p.key
}

/**
 * Convert a keydown event into a canonical binding for the shortcut
 * recorder, or null if it isn't a usable combo. A combo must include Mod
 * (except standalone function keys) — this rejects modifier-less letter
 * shortcuts that would fire while typing.
 */
export function eventToBinding(e: KeyboardEvent): string | null {
  const token = codeToToken(e.code)
  if (!token) return null
  const mod = e.metaKey || e.ctrlKey
  if (!mod && !isFunctionToken(token)) return null
  const parts: string[] = []
  if (mod) parts.push('Mod')
  if (e.altKey) parts.push('Alt')
  if (e.shiftKey && isLetterToken(token)) parts.push('Shift')
  parts.push(token)
  return parts.join('+')
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

const DISPLAY_KEY: Record<string, string> = {
  '=': '=',
  ',': ',',
  ' ': 'Space'
}

/** Human-readable rendering of a binding, e.g. "⌘⇧P" (mac) or "Ctrl+Shift+P". */
export function formatBinding(binding: string): string {
  const p = parseBinding(binding)
  if (!p) return binding
  const mac = isMac()
  const parts: string[] = []
  if (p.mod) parts.push(mac ? '⌘' : 'Ctrl')
  if (p.alt) parts.push(mac ? '⌥' : 'Alt')
  if (p.shift) parts.push(mac ? '⇧' : 'Shift')
  parts.push(DISPLAY_KEY[p.key] ?? p.key)
  return mac ? parts.join('') : parts.join('+')
}
