export const APP_NAME = 'Flux'
export const APP_VERSION = '1.0.0'
export const DEFAULT_WORKSPACE = 'FluxWorkspace'
export const BUILTIN_PLUGINS_DIR = 'builtin-plugins'
export const USER_PLUGINS_DIR = 'plugins'

/**
 * Plugin SDK ABI version. Bump the major when we change the shape of
 * PluginContext / PluginAPI / lifecycle hooks in a way that would break
 * existing plugins. Plugin authors declare `sdkVersion` in their manifest;
 * mismatched majors are refused at load time.
 */
export const SDK_ABI_VERSION = '1.0.0'

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
export const DEFAULT_DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1'
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-chat'

/**
 * Returned by SETTINGS_GET in place of the real API key. The renderer
 * displays "configured" and echoes this back on save when the user hasn't
 * changed the key, so the plaintext never enters renderer memory.
 */
export const API_KEY_SENTINEL = '__flux_key_configured__'
