/**
 * DMN built-in plugin. Editor lives in the renderer.
 */
module.exports = {
  onActivate(ctx) {
    ctx.logger.info('DMN plugin activated')
  },
  onDeactivate(ctx) {
    ctx.logger.info('DMN plugin deactivated')
  }
}
