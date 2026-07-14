/**
 * JSON editor plugin — main-process entry.
 *
 * There's essentially nothing to do here: the editor UI lives entirely
 * in `renderer/index.html`, which runs in a sandboxed iframe. This file
 * only exists so the plugin loader has a valid `main` to require.
 */
module.exports = {
  onActivate(ctx) {
    ctx.logger.info('JSON editor plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('JSON editor plugin deactivated')
  }
}
