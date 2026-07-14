/**
 * Excalidraw built-in plugin.
 *
 * The editor UI lives in the renderer as ExcalidrawEditor.tsx. This
 * main-process file exists only so the loader has a valid `main`.
 */
module.exports = {
  onActivate(ctx) {
    ctx.logger.info('Excalidraw plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('Excalidraw plugin deactivated')
  }
}
