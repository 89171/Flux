export const APP_NAME = 'PaiNote'
export const APP_VERSION = '1.0.0'
export const DEFAULT_WORKSPACE = 'PaiNoteWorkspace'
export const BUILTIN_PLUGINS_DIR = 'builtin-plugins'
export const USER_PLUGINS_DIR = 'plugins'

export const EXTENSION_FORMAT_MAP: Record<string, string> = {
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.mdx': 'markdown',
  '.drawio': 'drawio',
  '.xml': 'drawio',
  '.mm': 'mindmap',
  '.mindmap': 'mindmap',
  '.txt': 'plaintext'
}

export const DEFAULT_PIN_CONFIG = {
  alwaysOnTop: true,
  opacity: 1.0,
  autoCollapse: true,
  autoLaunch: false
}

export const MAIN_WINDOW_MIN_WIDTH = 800
export const MAIN_WINDOW_MIN_HEIGHT = 600
export const NOTE_WINDOW_DEFAULT_WIDTH = 480
export const NOTE_WINDOW_DEFAULT_HEIGHT = 600

export const DEFAULT_AI_MODEL = 'gpt-4o-mini'
export const DEFAULT_AI_BASE_URL = 'https://api.openai.com/v1'
