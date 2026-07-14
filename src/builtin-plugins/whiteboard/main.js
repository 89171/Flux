/**
 * Whiteboard built-in plugin.
 *
 * The editor UI lives in the renderer as WhiteboardEditor.tsx (a tldraw
 * React component). This file only exists so the plugin loader has a
 * valid `main` entry to require.
 */
module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Whiteboard plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Whiteboard plugin deactivated')
  }
}
